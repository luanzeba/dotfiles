#!/usr/bin/env node
// dot jobs: scheduled jobs declared in jobs.json, run by launchd (macOS) or systemd user timers (Linux).
// See README.md. Run through the `jobs` shim, which sets PATH and loads ~/.config/jobs/env.
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeSync,
  writeFileSync,
} from 'node:fs';
import { homedir, hostname, uptime } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { next, parseCron } from './cron.mjs';
import { installedAt, installedJobs, installUnit, isCurrent, isLoaded, startUnit, uninstallUnit, unitFile } from './units.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOTFILES = dirname(HERE);
const SHIM = join(HERE, 'jobs');
const STATE_ROOT = join(process.env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'jobs');
const COMMANDS = new Set(['run', 'exec', 'enable', 'disable', 'sync', 'check', 'help']);
const CHECK = 'jobs-check'; // the job that runs `jobs check`
const KEEP_LOGS = 10;
const FAILING_AFTER = 2; // consecutive failed runs
const LATE_AFTER_MS = 86_400_000; // a scheduled run that hasn't happened for a day
const STUCK_AFTER_S = 300; // past the timeout, which the runner enforces
const KILL_AFTER_MS = 10_000; // between SIGTERM and SIGKILL
const REQUIRES_WAIT_MS = 10 * 60_000;
const REQUIRES_EVERY_MS = 30_000;

// --- Definitions ------------------------------------------------------------------------------

const expandHome = path => (path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);

export function parseDuration(text) {
  const match = /^(\d+)(s|m|h|d)$/.exec(String(text));
  if (!match) throw new Error(`invalid duration "${text}" (use e.g. 90s, 30m, 2h)`);
  return Number(match[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[match[2]];
}

// The fields a definition may have, and their JSON types. Anything else is a typo.
const JOB_FIELDS = { description: 'string', schedule: 'string', command: 'string', pi: 'object', cwd: 'string',
  env: 'object', env_files: 'array', timeout: 'string', requires: 'string' };
const PI_FIELDS = { prompt: 'string', profile: 'string', model: 'string', thinking: 'string',
  max_cost: 'number', max_turns: 'number', args: 'array' };

function checkFields(object, fields, prefix = '') {
  for (const [field, value] of Object.entries(object)) {
    if (!fields[field]) throw new Error(`unknown field "${prefix}${field}"`);
    const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    if (type !== fields[field]) throw new Error(`${prefix}${field} must be a${fields[field] === 'array' ? 'n array' : ` ${fields[field]}`}`);
  }
}

export function parseJobs(definitions) {
  const jobs = {};
  for (const [name, definition] of Object.entries(definitions)) {
    try {
      jobs[name] = parseJob(name, definition);
    } catch (error) {
      throw new Error(`jobs.json: ${name}: ${error.message}`);
    }
  }
  return jobs;
}

function parseJob(name, job) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || COMMANDS.has(name)) throw new Error('invalid job name');
  checkFields(job, JOB_FIELDS);
  if (!job.schedule) throw new Error('schedule is required');
  if (!job.command === !job.pi) throw new Error('needs either command or pi');
  if (job.pi) {
    checkFields(job.pi, PI_FIELDS, 'pi.');
    if (!job.pi.prompt) throw new Error('pi.prompt is required');
    for (const field of ['max_cost', 'max_turns']) {
      if (job.pi[field] !== undefined && !(job.pi[field] > 0)) throw new Error(`pi.${field} must be more than 0`);
    }
  }
  const timeout = job.timeout ?? '30m';
  return {
    ...job,
    name,
    cron: parseCron(job.schedule),
    cwd: expandHome(job.cwd ?? '~'),
    env: job.env ?? {},
    env_files: (job.env_files ?? []).map(expandHome),
    timeout,
    timeoutSeconds: parseDuration(timeout),
    pi: job.pi && { max_cost: 5, max_turns: 100, args: [], ...job.pi },
  };
}

export const loadJobs = () => parseJobs(JSON.parse(readFileSync(join(HERE, 'jobs.json'), 'utf8')));

// --- State ------------------------------------------------------------------------------------
// <state>/<job>/state.json: { running?: {pid, started_at, log}, last?: run, last_success_at?, failures }
// where a run is { started_at, finished_at, duration_s, result: ok|failed|timeout|interrupted,
// exit_code, error?, log, pi?: {session, cost, tokens, turns, stopped?} }. Logs are <state>/<job>/logs/*.log.

export function readState(stateDir, name) {
  try {
    return JSON.parse(readFileSync(join(stateDir, name, 'state.json'), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(stateDir, name, state) {
  const file = join(stateDir, name, 'state.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

// --- Running ----------------------------------------------------------------------------------

const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
const stamp = date => date.toISOString().replace(/[:.]/g, '-');

function commandLine(job) {
  if (job.command) return job.command;
  const { pi } = job;
  const args = ['-p', '--name', `job ${job.name}`,
    ...(pi.model ? ['--model', pi.model] : []), ...(pi.thinking ? ['--thinking', pi.thinking] : []),
    '-e', join(HERE, 'pi-job.ts'), ...pi.args, '--', pi.prompt];
  return `exec pi ${args.map(quote).join(' ')}`;
}

function jobEnv(job, dir) {
  // Nothing from a parent pi session or the jobs config leaks in; scheduled and manual runs match.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PI|JOBS)_/.test(key)));
  Object.assign(env, { DOTFILES_DIR: DOTFILES, JOB_NAME: job.name }, job.env);
  if (job.pi) {
    Object.assign(env, {
      PI_TODO_PATH: join(dir, 'todos'),
      PI_JOB_RECORD: join(dir, 'pi-run.json'),
      PI_JOB_MAX_COST: String(job.pi.max_cost),
      PI_JOB_MAX_TURNS: String(job.pi.max_turns),
    }, job.pi.profile ? { PI_PROFILE: job.pi.profile } : {});
  }
  return env;
}

// sh runs the command after exporting every variable from the readable env_files. Their values are
// never written anywhere.
const shellArgs = (job, command) =>
  ['-c', `set -a; for f do [ -r "$f" ] && . "$f"; done; set +a; set --\n${command}`, 'sh', ...job.env_files];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForRequirement(job, env, log, { waitMs, everyMs }) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const result = spawnSync('/bin/sh', shellArgs(job, job.requires), {
      cwd: job.cwd, env, stdio: ['ignore', log, log], timeout: 30_000,
    });
    if (result.status === 0) return true;
    if (Date.now() + everyMs > deadline) return false;
    writeSync(log, `# requires failed; retrying in ${everyMs / 1000}s: ${job.requires}\n`);
    await sleep(everyMs);
  }
}

function runCommand(job, env, log, killAfterMs) {
  return new Promise(resolve => {
    const child = spawn('/bin/sh', shellArgs(job, commandLine(job)), {
      cwd: job.cwd, env, stdio: ['ignore', log, log], detached: true,
    });
    const signalGroup = signal => {
      try {
        process.kill(-child.pid, signal);
        return true;
      } catch {
        return false; // nobody left in the group
      }
    };
    // SIGTERM the group, then SIGKILL whatever is left after the grace period. It runs once, started by
    // a stop or by the command exiting, so nothing the command started outlives the run.
    let reaping, stopping;
    const reap = () => (reaping ??= (async () => {
      if (!signalGroup('SIGTERM')) return;
      const grace = Date.now() + killAfterMs;
      while (signalGroup(0) && Date.now() < grace) await sleep(100);
      signalGroup('SIGKILL');
    })());
    const stop = reason => {
      stopping ??= reason;
      reap();
    };
    // Wall-clock deadline: a run that sleeps past its timeout with the laptop is stopped on wake.
    const deadline = Date.now() + job.timeoutSeconds * 1000;
    const timer = setInterval(() => { if (Date.now() >= deadline) stop('timeout'); }, Math.min(5000, job.timeoutSeconds * 1000));
    const onSignal = () => stop('interrupted');
    const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'];
    for (const signal of signals) process.on(signal, onSignal);
    // A failed spawn can emit both error and exit; the first outcome wins.
    const finish = async outcome => {
      clearInterval(timer);
      await reap();
      for (const signal of signals) process.off(signal, onSignal);
      resolve(outcome);
    };
    child.on('error', error => finish({ result: 'failed', exit_code: null, error: error.message }));
    child.on('exit', (code, signal) => finish({
      result: stopping ?? (code === 0 ? 'ok' : 'failed'), exit_code: code, ...(signal ? { signal } : {}),
    }));
  });
}

// Runs a job once, in the foreground, and records it. launchd and systemd never start a job that is
// already running, so they are the lock between runs.
export async function runJob(job, {
  stateDir = STATE_ROOT, requiresWaitMs = REQUIRES_WAIT_MS, requiresEveryMs = REQUIRES_EVERY_MS, killAfterMs = KILL_AFTER_MS,
} = {}) {
  const dir = join(stateDir, job.name);
  mkdirSync(join(dir, 'logs'), { recursive: true });
  const started = new Date();
  const logFile = join(dir, 'logs', `${stamp(started)}.log`);
  const log = openSync(logFile, 'a');
  writeState(stateDir, job.name, { ...readState(stateDir, job.name), running: { pid: process.pid, started_at: started.toISOString(), log: logFile } });

  const env = jobEnv(job, dir);
  if (job.pi) rmSync(env.PI_JOB_RECORD, { force: true });
  writeSync(log, `# ${started.toISOString()} ${job.name} in ${job.cwd}: ${commandLine(job)}\n`);
  let outcome;
  if (!statSync(job.cwd, { throwIfNoEntry: false })?.isDirectory()) {
    outcome = { result: 'failed', exit_code: null, error: `working directory ${job.cwd} is not a directory` };
  } else if (job.requires && !(await waitForRequirement(job, env, log, { waitMs: requiresWaitMs, everyMs: requiresEveryMs }))) {
    outcome = { result: 'failed', exit_code: null, error: `requires still failing after ${Math.round(requiresWaitMs / 60_000)}m: ${job.requires}` };
  } else {
    outcome = await runCommand(job, env, log, killAfterMs);
  }
  const finished = new Date();
  const run = { started_at: started.toISOString(), finished_at: finished.toISOString(),
    duration_s: Math.round((finished - started) / 1000), ...outcome, log: logFile };
  if (job.pi) {
    try { run.pi = JSON.parse(readFileSync(env.PI_JOB_RECORD, 'utf8')); } catch { /* pi never started */ }
    if (run.pi?.stopped && run.result !== 'timeout') Object.assign(run, { result: 'failed', error: `stopped: ${run.pi.stopped}` });
  }
  writeSync(log, `# ${run.result}${run.exit_code != null ? ` (exit ${run.exit_code})` : ''} after ${run.duration_s}s${run.error ? `: ${run.error}` : ''}\n`);
  closeSync(log);

  const { running, ...state } = readState(stateDir, job.name);
  writeState(stateDir, job.name, {
    ...state,
    last: run,
    last_success_at: run.result === 'ok' ? run.finished_at : state.last_success_at,
    // A shutdown or logout in the middle of a run is not the job's failure.
    failures: run.result === 'ok' ? 0 : run.result === 'interrupted' ? state.failures ?? 0 : (state.failures ?? 0) + 1,
  });
  const logs = readdirSync(join(dir, 'logs')).filter(file => file.endsWith('.log')).sort();
  for (const old of logs.slice(0, -KEEP_LOGS)) rmSync(join(dir, 'logs', old), { force: true });
  return run;
}

// --- Health -----------------------------------------------------------------------------------

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false; // gone, or another user's process that reused the pid
  }
}

const bootedAt = (now = Date.now()) => now - uptime() * 1000;

// Whether state.running is a live run: its pid exists and it started after the last boot.
export function liveRun(state, now = Date.now()) {
  const running = state.running;
  if (!running) return undefined;
  return Date.parse(running.started_at) > bootedAt(now) && pidAlive(running.pid) ? running : undefined;
}

const unitFor = job => ({ name: job.name, program: SHIM, runnerLog: join(STATE_ROOT, job.name, 'runner.log'), schedule: job.cron });

// { problem, text }: problem is undefined when healthy. `installed` is when the unit was written, or
// undefined when the job isn't enabled here; `current` is whether it matches jobs.json.
export function health(job, { installed, loaded, current = true, state, running, now = Date.now(), booted = bootedAt(now) }) {
  if (!installed) {
    return job.name === CHECK ? { problem: 'off', text: 'off: nothing will alert' } : { text: 'off' };
  }
  if (!loaded) return { problem: 'not loaded', text: 'not loaded: run dot jobs sync' };
  if (!current) return { problem: 'out of date', text: 'out of date with jobs.json: run dot jobs sync' };
  const limit = job.timeoutSeconds + (job.requires ? REQUIRES_WAIT_MS / 1000 : 0) + STUCK_AFTER_S;
  if (running && now - Date.parse(running.started_at) > limit * 1000) {
    return { problem: 'stuck', text: `stuck: running past its ${job.timeout} timeout` };
  }
  if ((state.failures ?? 0) >= FAILING_AFTER) return { problem: 'failing', text: `failing: last ${state.failures} runs failed` };
  // Late: the scheduler hasn't started a run that was due more than a day ago. Failed runs are the
  // failing rule's business. Counted from the last run, enabling the job, or booting (launchd doesn't
  // catch up runs missed while powered off), whichever is latest.
  const since = Math.max(Date.parse(state.last?.started_at ?? '') || 0, installed.getTime(), booted);
  const due = next(job.cron, new Date(since));
  if (!running && due && due.getTime() <= now - LATE_AFTER_MS) {
    return { problem: 'late', text: state.last ? "late: hasn't run for over a day" : 'late: never ran' };
  }
  return { text: 'ok' };
}

export function jobStatus(job, { stateDir = STATE_ROOT, now = Date.now() } = {}) {
  const installed = installedAt(job.name);
  const loaded = installed ? isLoaded(job.name) : false;
  const current = installed ? isCurrent(unitFor(job)) : true;
  const state = readState(stateDir, job.name);
  const running = liveRun(state, now);
  return {
    name: job.name,
    schedule: job.schedule,
    enabled: Boolean(installed),
    loaded,
    running: running ?? null,
    interrupted: Boolean(state.running) && !running, // the runner died mid-run (reboot, kill -9)
    last: state.last ?? null,
    last_success_at: state.last_success_at ?? null,
    failures: state.failures ?? 0,
    next_run: installed ? next(job.cron, new Date(now))?.toISOString() ?? null : null,
    health: health(job, { installed, loaded, current, state, running, now }),
  };
}

// Units for jobs that are no longer in jobs.json keep firing until `dot jobs sync` removes them.
const orphan = name => ({
  name, schedule: null, enabled: true, loaded: isLoaded(name), running: null, interrupted: false, last: null,
  last_success_at: null, failures: 0, next_run: null,
  health: { problem: 'not in jobs.json', text: 'not in jobs.json: run dot jobs sync' },
});

const allStatuses = jobs => [...Object.values(jobs).map(job => jobStatus(job)),
  ...installedJobs().filter(name => !jobs[name]).map(orphan)];

// --- Alerts -----------------------------------------------------------------------------------

async function ntfy(url, title, message, problem) {
  const response = await fetch(url, {
    method: 'POST', body: message, signal: AbortSignal.timeout(15_000),
    headers: { Title: title, Tags: problem ? 'warning' : 'white_check_mark', Priority: problem ? 'high' : 'default' },
  });
  if (!response.ok) throw new Error(`ntfy answered ${response.status}`);
}

// Compares the problems with those already reported and sends one message when they change. Messages
// carry job names and problem kinds only, never output. Returns the current problems.
export async function check(statuses, { stateDir = STATE_ROOT, notify, log = console.log } = {}) {
  const problems = statuses.filter(s => s.health.problem).map(s => `${s.name}: ${s.health.text}`);
  const key = statuses.filter(s => s.health.problem).map(s => `${s.name}:${s.health.problem}`).sort().join(' ');
  const file = join(stateDir, 'check.json');
  let previous = '';
  try { previous = JSON.parse(readFileSync(file, 'utf8')).key; } catch { /* first check */ }
  for (const problem of problems) log(problem);
  if (key !== previous) {
    const host = hostname().replace(/\.local$/, '');
    if (!notify) {
      log('alerts are off: set JOBS_NTFY_URL in ~/.config/jobs/env');
      return problems; // not delivered, so not recorded: they're sent once alerts are set up
    }
    await notify(problems.length ? `jobs on ${host} need attention` : `jobs on ${host} are healthy again`,
      problems.length ? problems.join('\n') : 'Every job is healthy again.', problems.length > 0);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify({ key, problems, at: new Date().toISOString() }, null, 2)}\n`);
  }
  return problems;
}

async function ping(url, failed) {
  if (!url) return;
  await fetch(failed ? `${url.replace(/\/$/, '')}/fail` : url, { method: 'POST', signal: AbortSignal.timeout(15_000) })
    .catch(error => console.error(`heartbeat ping failed: ${error.message}`));
}

// --- CLI --------------------------------------------------------------------------------------

const USAGE = `dot jobs - scheduled jobs from jobs/jobs.json

  dot jobs                   every job: last run, result, last success, next run, health
  dot jobs --json            the same, for scripts
  dot jobs <job>             one job's details and the end of its last output
  dot jobs run <job>         run it now (through launchd/systemd when enabled) and show the output
  dot jobs enable <job>...   schedule it on this machine (also enables jobs-check)
  dot jobs disable <job>...  unschedule it here
  dot jobs sync              rewrite enabled jobs' launchd/systemd units after editing jobs.json
  dot jobs check             alert about unhealthy jobs (what jobs-check runs)

\`dot jobs\` (the table) exits 1 when a job needs attention; --json exits 0 unless it errors.
Alerts: JOBS_NTFY_URL and JOBS_HEARTBEAT_URL in ~/.config/jobs/env.`;

const tty = process.stdout.isTTY;
const red = text => (tty ? `\x1b[31m${text}\x1b[0m` : text);
const dim = text => (tty ? `\x1b[90m${text}\x1b[0m` : text);
const pad = (text, width) => text + ' '.repeat(Math.max(0, width - text.replace(/\x1b\[\d+m/g, '').length));
const tilde = path => (path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path);

function when(iso, now = new Date()) {
  if (!iso) return 'never';
  const date = new Date(iso);
  const time = date.toTimeString().slice(0, 5);
  if (date.toDateString() === now.toDateString()) return time;
  if (Math.abs(date - now) < 6 * 86_400_000) return `${date.toDateString().slice(0, 3)} ${time}`;
  return `${date.toDateString().slice(4, 10)} ${time}`;
}

function took(seconds) {
  if (seconds == null) return '';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(seconds / 3600)}h${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}m`;
}

function result(status) {
  if (status.running) return `running ${took(Math.round((Date.now() - Date.parse(status.running.started_at)) / 1000))}`;
  if (status.interrupted) return 'interrupted';
  const last = status.last;
  if (!last) return '-';
  if (last.result === 'failed' && last.exit_code != null) return `exit ${last.exit_code}`;
  return last.result;
}

function table(statuses) {
  const rows = statuses.map(s => [s.name, s.schedule ?? '?', when(s.running?.started_at ?? s.last?.started_at), result(s),
    s.running ? '' : took(s.last?.duration_s), when(s.last_success_at),
    s.next_run ? when(s.next_run) : '-', s.health.problem ? red(s.health.text) : s.enabled ? s.health.text : dim(s.health.text)]);
  const header = ['JOB', 'SCHEDULE', 'LAST RUN', 'RESULT', 'TOOK', 'LAST OK', 'NEXT', 'HEALTH'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].replace(/\x1b\[\d+m/g, '').length)));
  for (const row of [header, ...rows]) console.log(row.map((cell, i) => pad(cell, widths[i])).join('  ').trimEnd());
  const alerts = [process.env.JOBS_NTFY_URL && 'ntfy', process.env.JOBS_HEARTBEAT_URL && 'heartbeat'].filter(Boolean);
  console.log(dim(`\nalerts: ${alerts.length ? alerts.join(' + ') : 'off (set JOBS_NTFY_URL in ~/.config/jobs/env)'} · state: ${tilde(STATE_ROOT)}`));
}

function details(job, status) {
  const line = (label, value) => console.log(`  ${pad(label, 10)} ${value}`);
  console.log(`${job.name}${job.description ? ` - ${job.description}` : ''}`);
  line('schedule', `${job.schedule}${status.next_run ? ` (next ${when(status.next_run)})` : ''}`);
  line(job.pi ? 'pi' : 'command', job.pi ? JSON.stringify(job.pi) : job.command);
  line('cwd', tilde(job.cwd));
  line('timeout', job.timeout);
  if (job.requires) line('requires', job.requires);
  line('unit', status.enabled ? `${tilde(unitFile(job.name))}${status.loaded ? '' : ' (not loaded)'}` : 'not enabled here');
  line('health', status.health.problem ? red(status.health.text) : status.health.text);
  const last = status.last;
  if (status.running) line('running', `since ${when(status.running.started_at)}, pid ${status.running.pid}`);
  if (last) line('last run', `${when(last.started_at)}, ${result({ last })} after ${took(last.duration_s)}${last.error ? `: ${last.error}` : ''}`);
  line('last ok', when(status.last_success_at));
  if (last?.pi) {
    line('session', last.pi.session ? tilde(last.pi.session) : 'none');
    const cost = last.pi.cost < 0.01 ? last.pi.cost.toFixed(4) : last.pi.cost.toFixed(2);
    line('spent', `$${cost}, ${last.pi.turns} turns, ${last.pi.tokens} tokens${last.pi.stopped ? `; stopped: ${last.pi.stopped}` : ''}`);
  }
  const logFile = status.running?.log ?? last?.log;
  if (logFile && existsSync(logFile)) {
    line('log', tilde(logFile));
    const lines = readFileSync(logFile, 'utf8').trimEnd().split('\n');
    console.log(`\n${dim(`--- last ${Math.min(lines.length, 20)} of ${lines.length} lines ---`)}\n${lines.slice(-20).join('\n')}`);
  }
  const runnerLog = join(STATE_ROOT, job.name, 'runner.log');
  if (existsSync(runnerLog) && readFileSync(runnerLog, 'utf8').trim()) {
    console.log(dim(`\nThe scheduler logged runner errors in ${tilde(runnerLog)}`));
  }
}

function enable(job) {
  mkdirSync(join(STATE_ROOT, job.name), { recursive: true });
  return installUnit(unitFor(job));
}

async function follow(job, since) {
  // Wait for the run that started at or after `since` (or the one in progress) to finish.
  const deadline = Date.now() + (job.timeoutSeconds + 120) * 1000 + REQUIRES_WAIT_MS;
  let seen;
  while (Date.now() < deadline) {
    const state = readState(STATE_ROOT, job.name);
    if (liveRun(state)) seen ??= state.running.started_at;
    else if (state.last && (state.last.started_at === seen || Date.parse(state.last.started_at) >= since)) return state.last;
    await sleep(1000);
  }
  throw new Error(`${job.name} didn't finish in time; see dot jobs ${job.name}`);
}

async function main(argv) {
  const [command, ...args] = argv;
  if (command === 'help' || command === '-h' || command === '--help') return console.log(USAGE), 0;
  const jobs = loadJobs();
  const named = name => {
    if (!jobs[name]) throw new Error(`no job named "${name}" in jobs/jobs.json (have: ${Object.keys(jobs).join(', ')})`);
    return jobs[name];
  };

  switch (command) {
    case '--json': // for scripts: problems are in the data, so only errors exit nonzero
      console.log(JSON.stringify(allStatuses(jobs), null, 2));
      return 0;
    case undefined: {
      const statuses = allStatuses(jobs);
      table(statuses);
      return statuses.some(s => s.health.problem) ? 1 : 0;
    }
    case 'exec': { // what launchd and systemd run
      const run = await runJob(named(args[0]));
      return run.result === 'ok' ? 0 : 1;
    }
    case 'run': {
      const job = named(args[0]);
      const since = Date.now() - 1000;
      let run;
      if (installedAt(job.name)) {
        startUnit(job.name);
        console.log(dim(`started ${job.name} through the scheduler; waiting for it to finish...`));
        run = await follow(job, since);
      } else {
        console.log(dim(`${job.name} isn't enabled here; running it in this terminal...`));
        run = await runJob(job);
      }
      process.stdout.write(readFileSync(run.log, 'utf8'));
      return run.result === 'ok' ? 0 : 1;
    }
    case 'enable':
    case 'disable': {
      if (!args.length) throw new Error(`usage: dot jobs ${command} <job>...`);
      const names = args.map(name => named(name).name);
      if (command === 'enable' && !names.includes(CHECK)) names.push(CHECK);
      for (const name of names) {
        if (command === 'disable') {
          uninstallUnit(name);
          console.log(`disabled ${name}`);
        } else {
          const changed = enable(jobs[name]);
          console.log(`${changed ? 'enabled' : 'already enabled:'} ${name}, next run ${when(next(jobs[name].cron, new Date())?.toISOString())}`);
        }
      }
      return 0;
    }
    case 'sync': {
      for (const name of installedJobs()) {
        if (!jobs[name]) {
          uninstallUnit(name);
          console.log(`removed ${name} (no longer in jobs.json)`);
        } else if (enable(jobs[name])) {
          console.log(`reloaded ${name}`);
        }
      }
      return 0;
    }
    case 'check': {
      const { JOBS_NTFY_URL: url, JOBS_HEARTBEAT_URL: heartbeat } = process.env;
      try {
        await check(allStatuses(jobs), { notify: url && ((title, message, problem) => ntfy(url, title, message, problem)) });
      } catch (error) {
        await ping(heartbeat, true);
        throw error;
      }
      await ping(heartbeat, false);
      return 0;
    }
    default:
      if (command.startsWith('-')) throw new Error(`unknown option ${command}\n\n${USAGE}`);
      details(named(command), jobStatus(named(command)));
      return 0;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    console.error(`dot jobs: ${error.message}`);
    process.exitCode = 2;
  });
}
