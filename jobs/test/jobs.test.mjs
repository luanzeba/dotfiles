import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

process.env.TZ = 'Europe/Vienna';
const { check, health, parseDuration, parseJobs, readState, runJob } = await import('../jobs.mjs');

const scratches = [];
const scratch = () => scratches[scratches.push(mkdtempSync(join(tmpdir(), 'jobs-test-'))) - 1];
after(() => { for (const dir of scratches) rmSync(dir, { recursive: true, force: true }); });
const job = (definition, name = 'test') => parseJobs({ [name]: { schedule: '0 * * * *', ...definition } })[name];
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('validates definitions', () => {
  const cases = [
    [{ command: 'true', pi: { prompt: 'hi' } }, /either command or pi/],
    [{}, /either command or pi/],
    [{ command: 'true', when: 'later' }, /unknown field "when"/],
    [{ command: 'true', timeout: '10 minutes' }, /invalid duration/],
    [{ command: 'true', schedule: '@daily' }, /expected 5 fields/],
    [{ pi: { prompt: 'hi', budget: 1 } }, /unknown field "pi.budget"/],
    [{ pi: { prompt: 'hi', max_cost: '1' } }, /pi.max_cost must be a number/],
    [{ pi: { model: 'm' } }, /pi.prompt is required/],
    [{ pi: { prompt: 'hi', max_turns: 0 } }, /pi.max_turns must be more than 0/],
    [{ command: 'true', env_files: '~/x.env' }, /env_files must be an array/],
  ];
  for (const [definition, error] of cases) assert.throws(() => job(definition), error);
  assert.throws(() => parseJobs({ test: { command: 'true' } }), /schedule is required/);
  assert.throws(() => job({ command: 'true' }, 'run'), /invalid job name/);
  assert.throws(() => job({ command: 'true' }, 'Upper'), /invalid job name/);
  const parsed = job({ command: 'true', env_files: ['~/x.env'] });
  assert.equal(parsed.cwd, homedir());
  assert.deepEqual(parsed.env_files, [join(homedir(), 'x.env')]);
  assert.equal(parsed.timeoutSeconds, 1800);
  assert.deepEqual(job({ pi: { prompt: 'hi' } }).pi, { max_cost: 5, max_turns: 100, args: [], prompt: 'hi' });
  assert.equal(parseDuration('90s'), 90);
  assert.equal(parseDuration('2h'), 7200);
});

test('records a successful run and its output', async () => {
  const stateDir = scratch();
  const run = await runJob(job({ command: 'echo hello; pwd', cwd: tmpdir() }), { stateDir });
  assert.equal(run.result, 'ok');
  assert.equal(run.exit_code, 0);
  const log = readFileSync(run.log, 'utf8');
  assert.match(log, /^hello$/m);
  assert.match(log, /# ok \(exit 0\) after \d+s/);
  const state = readState(stateDir, 'test');
  assert.equal(state.running, undefined);
  assert.equal(state.last_success_at, run.finished_at);
  assert.equal(state.failures, 0);
});

test('counts consecutive failures until a success', async () => {
  const stateDir = scratch();
  const failing = job({ command: 'echo nope >&2; exit 3' });
  assert.equal((await runJob(failing, { stateDir })).exit_code, 3);
  const second = await runJob(failing, { stateDir });
  assert.equal(second.result, 'failed');
  assert.match(readFileSync(second.log, 'utf8'), /^nope$/m);
  assert.equal(readState(stateDir, 'test').failures, 2);
  assert.equal(readState(stateDir, 'test').last_success_at, undefined);
  await runJob(job({ command: 'true' }), { stateDir });
  assert.equal(readState(stateDir, 'test').failures, 0);
});

test('a timeout kills everything the command started', async () => {
  const stateDir = scratch();
  const pidFile = join(stateDir, 'pid');
  const run = await runJob(job({ command: `sleep 30 & echo $! > ${pidFile}; wait`, timeout: '1s' }), { stateDir });
  assert.equal(run.result, 'timeout');
  assert.ok(run.duration_s <= 3, `took ${run.duration_s}s`);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(alive(Number(readFileSync(pidFile, 'utf8'))), false);
  assert.equal(readState(stateDir, 'test').failures, 1);
});

test('whatever ignores SIGTERM gets SIGKILL, after a timeout and after a normal exit', async () => {
  const stateDir = scratch();
  const shell = await runJob(job({ command: 'trap "" TERM; while :; do sleep 0.1; done', timeout: '1s' }), { stateDir, killAfterMs: 300 });
  assert.equal(shell.result, 'timeout');
  assert.ok(shell.duration_s <= 2, `took ${shell.duration_s}s`);
  const stubborn = pidFile => `sh -c 'trap "" TERM; echo $$ > ${pidFile}; while :; do sleep 0.1; done' &`;
  const timedOut = join(stateDir, 'timed-out');
  const run = await runJob(job({ command: `${stubborn(timedOut)} wait`, timeout: '1s' }), { stateDir, killAfterMs: 300 });
  assert.equal(run.result, 'timeout');
  assert.equal(alive(Number(readFileSync(timedOut, 'utf8'))), false);
  const leftOver = join(stateDir, 'left-over');
  const done = await runJob(job({ command: `${stubborn(leftOver)} sleep 0.3; echo done` }), { stateDir, killAfterMs: 300 });
  assert.equal(done.result, 'ok');
  assert.equal(alive(Number(readFileSync(leftOver, 'utf8'))), false);
});

test('jobs get env files and their env, but not the parent pi session or jobs settings', async () => {
  const stateDir = scratch();
  const secrets = join(stateDir, 'secrets.env');
  writeFileSync(secrets, 'export SECRET=abc123\n');
  process.env.JOBS_NTFY_URL = 'https://ntfy.example/topic';
  process.env.PI_SESSION_FILE = '/parent/session.jsonl';
  try {
    const run = await runJob(job({
      command: 'test "$SECRET" = "abc$((100 + 23))" && test "$GREETING" = hi && test -z "$JOBS_NTFY_URL" && test -z "$PI_SESSION_FILE" && test "$JOB_NAME" = test && test -n "$DOTFILES_DIR"',
      env: { GREETING: 'hi' },
      env_files: [secrets, join(stateDir, 'missing.env')],
    }), { stateDir });
    assert.equal(run.result, 'ok', readFileSync(run.log, 'utf8'));
    assert.doesNotMatch(readFileSync(run.log, 'utf8'), /abc123/);
  } finally {
    delete process.env.JOBS_NTFY_URL;
    delete process.env.PI_SESSION_FILE;
  }
});

test('fails without running when requires never passes or cwd is missing', async () => {
  const stateDir = scratch();
  const marker = join(stateDir, 'ran');
  const blocked = await runJob(job({ command: `touch ${marker}`, requires: 'exit 1' }),
    { stateDir, requiresWaitMs: 400, requiresEveryMs: 20 });
  assert.equal(blocked.result, 'failed');
  assert.match(blocked.error, /requires still failing/);
  assert.equal(existsSync(marker), false);
  assert.match(readFileSync(blocked.log, 'utf8'), /requires failed; retrying/);
  const ready = await runJob(job({ command: `touch ${marker}`, requires: 'true' }), { stateDir });
  assert.equal(ready.result, 'ok');
  const nowhere = await runJob(job({ command: 'true', cwd: join(stateDir, 'nope') }), { stateDir });
  assert.match(nowhere.error, /is not a directory/);
  const aFile = await runJob(job({ command: 'true', cwd: marker }), { stateDir });
  assert.match(aFile.error, /is not a directory/);
});

test('keeps the last 10 logs', async () => {
  const stateDir = scratch();
  for (let i = 0; i < 12; i++) await runJob(job({ command: `echo ${i}` }), { stateDir });
  const logs = readdirSync(join(stateDir, 'test', 'logs'));
  assert.equal(logs.length, 10);
});

test('runs pi with the job profile, budget, and a recorded session', async () => {
  const stateDir = scratch();
  const bin = join(stateDir, 'bin');
  const fake = join(bin, 'pi');
  // A stand-in for pi: prints its arguments, and records what pi-job.ts would.
  mkdirSync(bin);
  writeFileSync(fake, `#!/bin/sh
printf '%s\\n' "$@"
echo "profile=$PI_PROFILE cost=$PI_JOB_MAX_COST turns=$PI_JOB_MAX_TURNS todos=$PI_TODO_PATH"
printf '{"session":"/s.jsonl","cost":0.5,"tokens":10,"turns":2%s}' "$STOP" > "$PI_JOB_RECORD"
`);
  chmodSync(fake, 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    const agent = job({ pi: { prompt: "/skill:demo it's done", profile: 'work', model: 'openai/m', max_cost: 0.5, args: ['--tools', 'read'] } });
    const run = await runJob(agent, { stateDir });
    assert.equal(run.result, 'ok', readFileSync(run.log, 'utf8'));
    const log = readFileSync(run.log, 'utf8');
    assert.match(log, /^-p\n--name\njob test\n--model\nopenai\/m\n-e\n.*pi-job\.ts\n--tools\nread\n--\n\/skill:demo it's done$/m);
    assert.match(log, new RegExp(`profile=work cost=0.5 turns=100 todos=${join(stateDir, 'test', 'todos')}`));
    assert.deepEqual(run.pi, { session: '/s.jsonl', cost: 0.5, tokens: 10, turns: 2 });

    const stopped = await runJob(parseJobs({ test: { schedule: '0 * * * *', pi: { prompt: 'x' }, env: { STOP: ',"stopped":"over budget"' } } }).test, { stateDir });
    assert.equal(stopped.result, 'failed');
    assert.equal(stopped.error, 'stopped: over budget');
  } finally {
    process.env.PATH = path;
  }
});

test('health: off, not loaded, out of date, stuck, failing, late', () => {
  const hourly = job({ command: 'true', timeout: '10m' });
  const now = Date.parse('2026-11-06T12:00:00Z');
  const hoursAgo = hours => new Date(now - hours * 3_600_000);
  const ran = hours => ({ last: { started_at: hoursAgo(hours).toISOString() } });
  const base = { installed: hoursAgo(72), loaded: true, state: {}, now, booted: 0 };

  assert.deepEqual(health(hourly, { ...base, installed: undefined }), { text: 'off' });
  assert.equal(health(job({ command: 'true' }, 'jobs-check'), { ...base, installed: undefined }).problem, 'off');
  assert.equal(health(hourly, { ...base, loaded: false }).problem, 'not loaded');
  assert.equal(health(hourly, { ...base, current: false }).problem, 'out of date');
  assert.equal(health(hourly, { ...base, running: { started_at: hoursAgo(0.5).toISOString() } }).problem, 'stuck');
  // A requires wait (up to 10 minutes) comes before the timeout starts.
  const waits = job({ command: 'true', timeout: '10m', requires: 'true' });
  assert.equal(health(waits, { ...base, running: { started_at: hoursAgo(0.3).toISOString() } }).text, 'ok');
  assert.equal(health(waits, { ...base, running: { started_at: hoursAgo(0.5).toISOString() } }).problem, 'stuck');

  assert.equal(health(hourly, { ...base, state: { ...ran(2), failures: 1 } }).text, 'ok');
  assert.equal(health(hourly, { ...base, state: { ...ran(2), failures: 2 } }).problem, 'failing');
  assert.equal(health(hourly, { ...base, state: ran(2) }).text, 'ok');
  assert.equal(health(hourly, { ...base, state: ran(25.5) }).text, "late: hasn't run for over a day");
  assert.equal(health(hourly, base).text, 'late: never ran');
  assert.equal(health(hourly, { ...base, installed: hoursAgo(20) }).text, 'ok'); // enabled less than a day ago
  assert.equal(health(hourly, { ...base, installed: hoursAgo(1), state: ran(24 * 7) }).text, 'ok'); // re-enabled
  assert.equal(health(hourly, { ...base, running: { started_at: hoursAgo(0.1).toISOString() } }).text, 'ok'); // catching up
});

test('health: a weekday job is not late over the weekend, and one failed catch-up is not an alert', () => {
  const weekdays = job({ command: 'true', schedule: '30 9 * * 1-5' });
  const friday = { started_at: new Date('2026-11-06T09:30').toISOString() };
  const base = { installed: new Date('2026-10-01T00:00'), loaded: true, state: { last: friday }, booted: 0 };
  assert.equal(health(weekdays, { ...base, now: Date.parse('2026-11-09T09:00') }).text, 'ok'); // Monday morning
  assert.equal(health(weekdays, { ...base, now: Date.parse('2026-11-10T09:00') }).text, 'ok'); // Monday's run is < 1 day late
  assert.equal(health(weekdays, { ...base, now: Date.parse('2026-11-10T09:31') }).problem, 'late');

  // Lid shut Friday evening, opened Monday: the hourly job's catch-up run fails once.
  const hourly = job({ command: 'true' });
  const monday = { started_at: new Date('2026-11-09T09:00').toISOString(), result: 'failed' };
  const state = { last: monday, failures: 1, last_success_at: new Date('2026-11-06T18:00').toISOString() };
  assert.equal(health(hourly, { ...base, state, now: Date.parse('2026-11-09T09:15') }).text, 'ok');

  // Shut down Friday evening, booted Monday: launchd doesn't catch up, so nothing has run yet.
  const off = { ...base, state: { last: { started_at: new Date('2026-11-06T18:00').toISOString() } } };
  const afterBoot = Date.parse('2026-11-09T09:17');
  assert.equal(health(hourly, { ...off, now: afterBoot, booted: Date.parse('2026-11-09T09:05') }).text, 'ok');
  assert.equal(health(hourly, { ...off, now: afterBoot }).problem, 'late'); // up since before Friday: it is late
});

test('check notifies when the set of problems changes, and when it clears', async () => {
  const stateDir = scratch();
  const sent = [];
  const notify = async (title, message, problem) => sent.push({ title, message, problem });
  const quiet = () => {};
  const status = (name, problem, text = problem) => ({ name, health: problem ? { problem, text } : { text: 'ok' } });

  await check([status('a'), status('b', 'failing', 'failing: last 2 runs failed')], { stateDir, notify, log: quiet });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].problem, true);
  assert.match(sent[0].message, /^b: failing: last 2 runs failed$/);
  await check([status('a'), status('b', 'failing', 'failing: last 3 runs failed')], { stateDir, notify, log: quiet });
  assert.equal(sent.length, 1, 'a longer failure streak is the same problem');
  await check([status('a', 'late'), status('b', 'failing')], { stateDir, notify, log: quiet });
  assert.equal(sent.length, 2);
  await check([status('a'), status('b')], { stateDir, notify, log: quiet });
  assert.equal(sent.length, 3);
  assert.equal(sent[2].problem, false);
  assert.match(sent[2].title, /healthy again/);
  await check([status('a'), status('b')], { stateDir, notify, log: quiet });
  assert.equal(sent.length, 3);

});

test('problems found while alerts are off are sent once alerts are set up', async () => {
  const stateDir = scratch();
  const logged = [];
  const late = [{ name: 'a', health: { problem: 'late', text: 'late' } }];
  await check(late, { stateDir, log: line => logged.push(line) });
  assert.match(logged.join('\n'), /alerts are off/);
  const sent = [];
  await check(late, { stateDir, notify: async (...args) => sent.push(args), log: () => {} });
  assert.equal(sent.length, 1);
});

test('check fails loudly when the alert cannot be delivered', async () => {
  const stateDir = scratch();
  const notify = async () => { throw new Error('ntfy answered 500'); };
  const late = [{ name: 'a', health: { problem: 'late', text: 'late' } }];
  await assert.rejects(check(late, { stateDir, notify, log: () => {} }), /ntfy answered 500/);
  // Not marked as delivered, so the next check tries again.
  const sent = [];
  await check(late, { stateDir, notify: async (...args) => sent.push(args), log: () => {} });
  assert.equal(sent.length, 1);
});
