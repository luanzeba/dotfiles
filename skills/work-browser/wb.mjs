#!/usr/bin/env node
// wb: a headless Google Chrome for agents, signed in once, one set of tabs per agent.
//
// One browser per machine runs headless with its own profile, so it never
// takes focus or touches your Chrome. Each agent (keyed by PI_SESSION_ID) only
// sees the tabs it opened. Signing in happens in a normal Chrome window on the
// same profile, with your extensions (1Password) on; agents can't reach that
// window. `wb sync <host>` copies BETA app sessions to another machine's wb.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = os.homedir();
const PORT = Number(process.env.WB_PORT || 9333);
const INSPECT_PORT = Number(process.env.WB_INSPECT_PORT || PORT);
const STATE = process.env.WB_STATE || path.join(HOME, ".local/state/work-browser");
const PROFILE = process.env.WB_PROFILE || path.join(HOME, ".local/share/work-browser/profile");
const CHROME =
  process.env.WB_CHROME ||
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
const OWNER = (process.env.WB_OWNER || process.env.PI_SESSION_ID || "default").replace(/[^\w-]/g, "_");
const OWNERS = path.join(STATE, "owners");
const RECORDINGS = path.join(STATE, "recordings");
const SIGNIN = path.join(STATE, "signin.json");
const STALE_OWNER_MS = 12 * 60 * 60 * 1000;
const ONEPASSWORD = "aeblfdkhhhdcdjpifhhbdiojplfjncoa";
const SELF = fileURLToPath(import.meta.url);

// Shared by the headless browser and the sign-in window, so both see the same sites the same way.
const COMMON_FLAGS = [
  "--no-first-run",
  "--no-default-browser-check",
  // Experimental WebMCP: pages register tools on document.modelContext.
  "--enable-features=WebMCPTesting,DevToolsWebMCPSupport",
  "--enable-blink-features=WebMCP,WebMCPTesting",
];

// What `wb sync` copies: BETA's apps (Ground, Operate, GitLab, AMPECO's
// cp.watts, and their Kinde sign-in at auth.beta.team) and Linear. Nothing
// else, so a Microsoft (Entra) or AWS session, which could approve new sign-ins
// including AWS SSO, stays on the machine where you signed in.
const SYNC_DOMAINS = /(^|\.)(beta\.team|linear\.app)$/;
// Linear's API also wants two localStorage entries (who you are, which client)
// with its cookie. `robots.txt` is on Linear's site without starting the app.
const SYNC_STORAGE = { url: "https://linear.app/robots.txt", keys: ["ApplicationStore", "clientId"] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class WbError extends Error {}
const fail = (message) => {
  throw new WbError(message);
};

// ── Chrome DevTools Protocol ────────────────────────────────────────────────

class CDP {
  #id = 0;
  #pending = new Map();
  #listeners = new Set();

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new WbError(`can't connect to Chrome at ${url}`));
    });
    return new CDP(ws);
  }

  constructor(ws) {
    this.ws = ws;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === undefined) {
        for (const listener of this.#listeners) listener(msg);
        return;
      }
      const call = this.#pending.get(msg.id);
      if (!call) return;
      this.#pending.delete(msg.id);
      clearTimeout(call.timer);
      if (msg.error) call.reject(new WbError(`${call.method}: ${msg.error.message}${msg.error.data ? ` (${msg.error.data})` : ""}`));
      else call.resolve(msg.result);
    };
    ws.onclose = () => {
      for (const call of this.#pending.values()) call.reject(new WbError("Chrome closed the connection"));
      this.#pending.clear();
    };
  }

  send(method, params = {}, sessionId, timeoutMs = 30_000) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new WbError(`${method} timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  waitFor(predicate, timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        off();
        resolve(null);
      }, timeoutMs);
      const off = this.on((msg) => {
        if (!predicate(msg)) return;
        clearTimeout(timer);
        off();
        resolve(msg);
      });
    });
  }

  close() {
    this.ws.close();
  }
}

// ── The headless browser ────────────────────────────────────────────────────

async function hostVersion() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Signing in holds the profile while `wb signin` or its Chrome window is alive.
function signingIn() {
  try {
    const { wb, chrome } = JSON.parse(fs.readFileSync(SIGNIN, "utf8"));
    return [wb, chrome].some((pid) => pid && alive(pid));
  } catch {
    return false;
  }
}

// The Chrome holding the profile (its SingletonLock -> "host-pid"), if it's still running.
// A lock left by a Chrome that died, whose pid now belongs to something else, doesn't count.
function profileHolder() {
  try {
    const lock = fs.readlinkSync(path.join(PROFILE, "SingletonLock"));
    const pid = Number(lock.split("-").pop());
    if (!pid || lock !== `${os.hostname()}-${pid}` || !alive(pid)) return null;
    const name = execFileSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" });
    return /chrome/i.test(name) ? pid : null;
  } catch {
    return null;
  }
}

async function waitForProfile() {
  for (let i = 0; i < 60 && profileHolder(); i++) await sleep(250);
}

// Headless Chrome says "HeadlessChrome" in its user agent, which some sign-in
// pages treat differently. Present as the same Chrome, minus that word.
function userAgent() {
  const major = installedVersion().split(".")[0];
  const platform = process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : "X11; Linux x86_64";
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

function installedVersion() {
  const version = execFileSync(CHROME, ["--version"], { encoding: "utf8" }).match(/\d+\.\d+\.\d+\.\d+/);
  if (!version) fail(`can't read the version of ${CHROME}`);
  return version[0];
}

// Chrome gets updated on disk (apt on the box, Google's updater on the Mac), but
// the running browser keeps the old version. Restart it once no agent is using it.
async function restartIfUpdated() {
  const version = await hostVersion();
  if (!version || version.Browser.endsWith(`/${installedVersion()}`)) return;
  const inUse = readdirSafe(OWNERS).some((f) => ownerAge(f) < STALE_OWNER_MS);
  if (inUse || readdirSafe(RECORDINGS).some((f) => activeRecording(path.join(RECORDINGS, f)))) return;
  await stopHost();
}

async function ensureHost() {
  const running = await hostVersion();
  if (running) return running;
  if (signingIn()) fail("signing in: finish in the Chrome window and quit it (⌘Q), then try again");
  // A Chrome that just quit (the sign-in window, `wb stop`) can hold the profile a moment longer.
  await waitForProfile();
  if (profileHolder()) fail(`another Chrome (pid ${profileHolder()}) has ${PROFILE} open`);
  if (!fs.existsSync(CHROME) && CHROME.includes("/")) fail(`Google Chrome not found at ${CHROME}`);
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.mkdirSync(STATE, { recursive: true });
  const log = fs.openSync(path.join(STATE, "chrome.log"), "a");
  const args = [
    "--headless",
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`,
    // Lets a pasted devtools:// link connect (web pages can't have this origin).
    "--remote-allow-origins=devtools://devtools",
    // Extensions (1Password) only run in the sign-in window, never with agents.
    "--disable-extensions",
    `--user-agent=${userAgent()}`,
    "--window-size=1440,900",
    "--mute-audio",
    // Keep every agent's tab rendering at full speed, for screenshots and recordings.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    ...COMMON_FLAGS,
    "about:blank",
  ];
  spawn(CHROME, args, { detached: true, stdio: ["ignore", log, log] }).unref();
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    const version = await hostVersion();
    if (version) return version;
  }
  fail(`Chrome didn't start; see ${path.join(STATE, "chrome.log")}`);
}

async function browser() {
  const version = await ensureHost();
  return CDP.connect(version.webSocketDebuggerUrl);
}

async function withBrowser(fn) {
  const cdp = await browser();
  try {
    return await fn(cdp);
  } finally {
    cdp.close();
  }
}

async function stopHost() {
  const version = await hostVersion();
  if (!version) return false;
  const cdp = await CDP.connect(version.webSocketDebuggerUrl);
  await cdp.send("Browser.close").catch(() => {});
  for (let i = 0; i < 40 && (await hostVersion()); i++) await sleep(250);
  await waitForProfile();
  return true;
}

// ── Tabs per agent ──────────────────────────────────────────────────────────

const ownerFile = (owner = OWNER) => path.join(OWNERS, `${owner}.json`);

function readOwner(owner = OWNER) {
  const empty = { tabs: [], current: null, openers: {} };
  try {
    return { ...empty, ...JSON.parse(fs.readFileSync(ownerFile(owner), "utf8")) };
  } catch {
    return empty;
  }
}

// Written whole (temp file, then rename): the recorder reads it while agents write it.
function writeOwner(data) {
  fs.mkdirSync(OWNERS, { recursive: true });
  const tmp = path.join(STATE, `.owner-${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, ownerFile());
}

// Where an agent goes when its current tab is gone: back to the tab that opened
// it (a sign-in popup that closed itself), else its newest tab.
function handBack(owner, live) {
  let id = owner.current;
  while (id && !live(id)) id = owner.openers[id];
  return id ?? owner.tabs.filter(live).at(-1) ?? null;
}

async function pages(cdp) {
  const { targetInfos } = await cdp.send("Target.getTargets");
  return targetInfos.filter((t) => t.type === "page");
}

// How long since an agent last used its tabs (Infinity once it has closed them).
function ownerAge(file) {
  try {
    return Date.now() - fs.statSync(path.join(OWNERS, file)).mtimeMs;
  } catch {
    return Infinity;
  }
}

// Agents that went away leave tabs behind; close those after 12 hours unused.
async function closeStaleOwners(cdp) {
  for (const file of readdirSafe(OWNERS)) {
    if (file === `${OWNER}.json` || ownerAge(file) < STALE_OWNER_MS) continue;
    const { tabs } = readOwner(file.replace(/\.json$/, ""));
    for (const targetId of tabs) await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
    fs.rmSync(path.join(OWNERS, file), { force: true });
  }
}

// The agent's live tabs. Tabs its pages opened themselves (target=_blank,
// window.open) are its tabs too, and the newest one becomes current.
async function liveOwner(cdp) {
  const owner = readOwner();
  const byId = new Map((await pages(cdp)).map((t) => [t.targetId, t]));
  for (const t of byId.values()) {
    if (t.openerId && owner.tabs.includes(t.openerId) && !owner.tabs.includes(t.targetId)) {
      owner.tabs.push(t.targetId);
      owner.openers[t.targetId] = t.openerId;
      owner.current = t.targetId;
    }
  }
  owner.current = handBack(owner, (id) => byId.has(id));
  owner.tabs = owner.tabs.filter((id) => byId.has(id));
  owner.openers = Object.fromEntries(Object.entries(owner.openers).filter(([id]) => byId.has(id)));
  return { owner, byId };
}

// The agent's current tab, opening one when it has none (or when asked for a new one).
async function currentTab(cdp, newTab = false) {
  const { owner } = await liveOwner(cdp);
  if (newTab || !owner.current) {
    // A window of its own, so `wb viewport` only resizes this agent's page.
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", newWindow: true, background: true });
    owner.tabs.push(targetId);
    owner.current = targetId;
  }
  writeOwner(owner);
  return owner.current;
}

const withTab = (fn, { newTab = false } = {}) =>
  withBrowser(async (cdp) => {
    await closeStaleOwners(cdp);
    const targetId = await currentTab(cdp, newTab);
    // Bring the tab to the front of its own window: a tab a page opened on top
    // of it would otherwise leave it hidden (no screencast frames, paused
    // animations). Headless Chrome has no OS windows, so this takes no focus.
    await cdp.send("Target.activateTarget", { targetId });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const page = (method, params, timeoutMs) => cdp.send(method, params, sessionId, timeoutMs);
    return fn({ cdp, page, sessionId, targetId });
  });

async function evaluate(page, expression, { awaitPromise = true } = {}) {
  const { result, exceptionDetails } = await page("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (exceptionDetails) fail(exceptionDetails.exception?.description?.split("\n")[0] || exceptionDetails.text);
  return result.value;
}

const describe = (page) => evaluate(page, "location.href + '\\n' + document.title");

// ── Commands ────────────────────────────────────────────────────────────────

const commands = {};

commands.open = ([url], flags) =>
  withTab(
    async ({ cdp, page, sessionId }) => {
      if (!url) fail("usage: wb open <url> [--new-tab]");
      const target = /^(https?|file|about|data|chrome):/i.test(url)
        ? url
        : `${/^(localhost|127\.0\.0\.1)(:|\/|$)/.test(url) ? "http" : "https"}://${url}`;
      await page("Page.enable");
      const loaded = cdp.waitFor((m) => m.sessionId === sessionId && m.method === "Page.loadEventFired", 30_000);
      const nav = await page("Page.navigate", { url: target });
      if (nav.errorText) fail(`${target}: ${nav.errorText}`);
      if (nav.loaderId) await loaded;
      console.log(await describe(page));
    },
    { newTab: flags["new-tab"] },
  );

commands.tabs = () =>
  withBrowser(async (cdp) => {
    const { owner, byId } = await liveOwner(cdp);
    writeOwner(owner);
    if (!owner.tabs.length) return console.log("no tabs");
    owner.tabs.forEach((id, i) => {
      const t = byId.get(id);
      console.log(`${id === owner.current ? "*" : " "} ${i + 1}  ${t.url}  ${t.title}`);
    });
  });

commands.tab = ([n]) =>
  withBrowser(async (cdp) => {
    const { owner, byId } = await liveOwner(cdp);
    const id = owner.tabs[Number(n) - 1];
    if (!id) fail(`no tab ${n}; see \`wb tabs\``);
    owner.current = id;
    writeOwner(owner);
    console.log(`${byId.get(id).url}\n${byId.get(id).title}`);
  });

commands.close = async (_, flags) => {
  const version = await hostVersion();
  if (!version) return;
  const cdp = await CDP.connect(version.webSocketDebuggerUrl);
  try {
    const { owner } = await liveOwner(cdp);
    const toClose = flags.all ? owner.tabs : [owner.current].filter(Boolean);
    for (const targetId of toClose) await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
    const live = (id) => !toClose.includes(id);
    owner.current = handBack(owner, live);
    owner.tabs = owner.tabs.filter(live);
    if (owner.tabs.length) writeOwner(owner);
    else fs.rmSync(ownerFile(), { force: true });
    console.log(`closed ${toClose.length} tab${toClose.length === 1 ? "" : "s"}`);
  } finally {
    cdp.close();
  }
};

const readStdin = () => fs.readFileSync(0, "utf8");

commands.eval = ([expression]) =>
  withTab(async ({ page }) => {
    if (!expression) fail("usage: wb eval '<javascript>' (or - to read it from stdin)");
    const value = await evaluate(page, expression === "-" ? readStdin() : expression);
    if (value !== undefined) console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  });

// Numbered, visible, interactive elements (and headings, for orientation).
const SNAPSHOT = String.raw`(() => {
  const interactive = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=radio],[role=switch],[role=combobox],[role=textbox],[contenteditable=""],[contenteditable=true]';
  document.querySelectorAll('[data-wb-ref]').forEach((e) => e.removeAttribute('data-wb-ref'));
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(e);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const name = (e) => clean(e.getAttribute('aria-label') || e.labels?.[0]?.innerText || e.innerText || (e.type !== 'password' && e.value) || e.placeholder || e.title || e.alt || e.getAttribute('name'));
  const roles = { A: 'link', BUTTON: 'button', SELECT: 'select', TEXTAREA: 'textbox', SUMMARY: 'button' };
  const lines = ['# ' + document.title + ' (' + location.href + ')'];
  let n = 0;
  for (const e of document.querySelectorAll(interactive + ',h1,h2,h3')) {
    if (!visible(e)) continue;
    if (/^H[1-3]$/.test(e.tagName)) { lines.push('#'.repeat(Number(e.tagName[1]) + 1) + ' ' + clean(e.innerText)); continue; }
    e.setAttribute('data-wb-ref', ++n);
    const role = e.getAttribute('role') || roles[e.tagName] || (e.tagName === 'INPUT' ? 'input[' + e.type + ']' : e.tagName.toLowerCase());
    const extra = [];
    if (e.tagName === 'A') extra.push(e.getAttribute('href'));
    if (e.disabled || e.getAttribute('aria-disabled') === 'true') extra.push('disabled');
    if (e.checked || e.getAttribute('aria-checked') === 'true') extra.push('checked');
    lines.push('@' + n + ' ' + role + ' "' + name(e) + '"' + (extra.length ? ' (' + extra.join(', ') + ')' : ''));
  }
  return lines.join('\n');
})()`;

commands.snapshot = (_, flags) =>
  withTab(async ({ page }) => {
    const lines = (await evaluate(page, SNAPSHOT)).split("\n");
    const limit = Number(flags.limit || 300);
    console.log(lines.slice(0, limit).join("\n"));
    if (lines.length > limit) console.log(`… ${lines.length - limit} more (use --limit)`);
  });

// JavaScript that finds a target: @N from `wb snapshot`, text=Label, or a CSS selector.
function findElement(target) {
  if (/^@\d+$/.test(target)) return `document.querySelector('[data-wb-ref="${target.slice(1)}"]')`;
  if (target.startsWith("text=")) {
    const text = JSON.stringify(target.slice(5).trim().toLowerCase());
    return `(() => {
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      // The visible element with the tightest label, and among equals the innermost,
      // so "Delete" picks the button rather than the dialog or grid cell around it.
      const pick = (elements, label) => {
        const matches = [...elements].map((e) => [e, label(e)]).filter(([e, l]) => {
          if (!l.includes(${text})) return false;
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        const shortest = Math.min(...matches.map(([, l]) => l.length));
        const tight = matches.filter(([, l]) => l.length === shortest).map(([e]) => e);
        return tight.find((e) => !tight.some((o) => o !== e && e.contains(o)));
      };
      // Controls first; otherwise any element with that text (for \`wb wait text=…\`).
      return pick(document.querySelectorAll('a,button,input,select,textarea,summary,label,[role],[onclick],[tabindex]'),
          (e) => norm(e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder))
        ?? pick(document.body.querySelectorAll('*'), (e) => norm(e.innerText));
    })()`;
  }
  return `document.querySelector(${JSON.stringify(target)})`;
}

async function elementCenter(page, target) {
  const point = await evaluate(
    page,
    `(() => {
      const e = ${findElement(target)};
      if (!e) return null;
      e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`,
  );
  if (!point) fail(`no element matches ${target}${target.startsWith("@") ? " (refs change after each `wb snapshot`)" : ""}`);
  return point;
}

const recordingFile = () => path.join(RECORDINGS, `${OWNER}.json`);

// The live recording of an owner, or null: { pid, out, started }.
function activeRecording(file = recordingFile()) {
  try {
    const info = JSON.parse(fs.readFileSync(file, "utf8"));
    return alive(info.pid) ? info : null;
  } catch {
    return null;
  }
}

// In recordings, show where each click lands.
const CLICK_MARK = (x, y) => `(() => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:${x - 14}px;top:${y - 14}px;width:28px;height:28px;border-radius:50%;background:rgba(255,64,64,.45);border:2px solid #ff4040;z-index:2147483647;pointer-events:none;transition:opacity .6s .3s,transform .6s .3s';
  document.documentElement.appendChild(d);
  requestAnimationFrame(() => { d.style.opacity = '0'; d.style.transform = 'scale(1.8)'; });
  setTimeout(() => d.remove(), 1200);
})()`;

async function click(page, target) {
  const { x, y } = await elementCenter(page, target);
  if (activeRecording()) {
    await evaluate(page, CLICK_MARK(x, y), { awaitPromise: false });
    await sleep(150);
  }
  await page("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await page("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

commands.click = ([target]) =>
  withTab(async ({ cdp, page, targetId }) => {
    if (!target) fail("usage: wb click <@ref|text=Label|css selector>");
    await click(page, target);
    await sleep(300);
    const { owner, byId } = await liveOwner(cdp);
    writeOwner(owner);
    if (owner.current !== targetId) {
      const t = byId.get(owner.current);
      return console.log(`opened a new tab, now your current one:\n${t.url}\n${t.title}`);
    }
    console.log(await describe(page));
  });

commands.type = ([target, text], flags) =>
  withTab(async ({ page }) => {
    if (!target || text === undefined) fail("usage: wb type <@ref|text=Label|selector> <text> [--append] (text - reads stdin)");
    await click(page, target);
    // Replace everything, or with --append put the caret at the end (the click left it mid-text).
    await evaluate(
      page,
      flags.append
        ? `(() => { const e = document.activeElement; if (e?.selectionStart != null) e.setSelectionRange(e.value.length, e.value.length); else if (e?.isContentEditable) { const r = document.createRange(); r.selectNodeContents(e); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } })()`
        : `(() => { const e = document.activeElement; if (e?.select) e.select(); else document.execCommand('selectAll'); })()`,
    );
    await page("Input.insertText", { text: text === "-" ? readStdin().replace(/\n$/, "") : text });
    console.log("typed");
  });

const KEYS = {
  Enter: [13, "\r"],
  Tab: [9, ""],
  Escape: [27, ""],
  Backspace: [8, ""],
  Delete: [46, ""],
  ArrowUp: [38, ""],
  ArrowDown: [40, ""],
  ArrowLeft: [37, ""],
  ArrowRight: [39, ""],
  Home: [36, ""],
  End: [35, ""],
  PageUp: [33, ""],
  PageDown: [34, ""],
};

commands.press = ([key]) =>
  withTab(async ({ page }) => {
    const entry = KEYS[key] || (key?.length === 1 ? [key.toUpperCase().charCodeAt(0), key] : null);
    if (!entry) fail(`usage: wb press <${Object.keys(KEYS).join("|")}|single character>`);
    const [code, text] = entry;
    const base = { key, code: key.length === 1 ? undefined : key, windowsVirtualKeyCode: code };
    await page("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: text || undefined });
    await page("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await sleep(200);
    console.log(await describe(page));
  });

commands.wait = ([target], flags) =>
  withTab(async ({ page }) => {
    const timeout = Number(flags.timeout || 15_000);
    if (!target && !flags.url) fail("usage: wb wait <@ref|text=Label|selector> [--timeout ms] | wb wait --url <part of url>");
    const check = flags.url
      ? `location.href.includes(${JSON.stringify(flags.url)})`
      : `(() => { const e = ${findElement(target)}; if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(page, check).catch(() => false)) return console.log(await describe(page));
      await sleep(250);
    }
    fail(`timed out after ${timeout / 1000}s waiting for ${flags.url ? `url ~ ${flags.url}` : target}`);
  });

const defaultArtifact = (ext) =>
  path.join(os.tmpdir(), `wb-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`);

commands.screenshot = ([file], flags) =>
  withTab(async ({ page }) => {
    const out = path.resolve(file || defaultArtifact("png"));
    const params = { format: out.endsWith(".jpg") || out.endsWith(".jpeg") ? "jpeg" : "png" };
    if (flags.full) {
      const { cssContentSize } = await page("Page.getLayoutMetrics");
      params.captureBeyondViewport = true;
      params.clip = { x: 0, y: 0, width: Math.ceil(cssContentSize.width), height: Math.ceil(cssContentSize.height), scale: 1 };
    } else if (flags.element) {
      const rect = await evaluate(
        page,
        `(() => { const e = ${findElement(flags.element)}; if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`,
      );
      if (!rect) fail(`no element matches ${flags.element}`);
      params.captureBeyondViewport = true;
      params.clip = { ...rect, scale: 1 };
    }
    const { data } = await page("Page.captureScreenshot", params, 60_000);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(data, "base64"));
    console.log(out);
  });

commands.viewport = ([width, height]) =>
  withTab(async ({ cdp, targetId, page }) => {
    if (!width || !height) fail("usage: wb viewport <width> <height>");
    const { windowId } = await cdp.send("Browser.getWindowForTarget", { targetId });
    // The page's size, not the window's (headless windows still keep room for a frame).
    await cdp.send("Browser.setContentsSize", { windowId, width: Number(width), height: Number(height) });
    let size;
    for (let i = 0; i < 10 && size !== `${width}x${height}`; i++) {
      if (i) await sleep(100);
      size = await evaluate(page, "innerWidth + 'x' + innerHeight");
    }
    console.log(size === `${width}x${height}` ? size : `${size}: Chrome's windows are at least 500 px wide`);
  });

commands.console = (_, flags) =>
  withTab(async ({ cdp, page, sessionId }) => {
    const lines = [];
    const off = cdp.on((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === "Runtime.consoleAPICalled") {
        const text = m.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ");
        const where = m.params.stackTrace?.callFrames?.[0];
        lines.push(`[${m.params.type}] ${text}${where?.url ? `  (${where.url}:${where.lineNumber + 1})` : ""}`);
      } else if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        lines.push(`[uncaught] ${d.exception?.description?.split("\n")[0] ?? d.text}${d.url ? `  (${d.url}:${d.lineNumber + 1})` : ""}`);
      } else if (m.method === "Log.entryAdded") {
        const e = m.params.entry;
        lines.push(`[${e.source} ${e.level}] ${e.text}${e.url ? `  (${e.url})` : ""}`);
      }
    });
    // Enabling these replays what the page logged before we attached.
    await page("Runtime.enable");
    await page("Log.enable");
    await sleep(400);
    off();
    console.log(lines.length ? lines.join("\n") : "no console messages");
    if (flags.clear) {
      await page("Runtime.discardConsoleEntries");
      await page("Log.clear");
    }
  });

commands.webmcp = ([tool, input]) =>
  withTab(async ({ page }) => {
    if (!tool) {
      const tools = await evaluate(
        page,
        `(async () => document.modelContext ? (await document.modelContext.getTools()).map((t) => ({ name: t.name, description: t.description, inputSchema: typeof t.inputSchema === 'string' ? JSON.parse(t.inputSchema) : t.inputSchema })) : null)()`,
      );
      if (tools === null) fail("this page has no document.modelContext");
      return console.log(tools.length ? JSON.stringify(tools, null, 2) : "the page registered no WebMCP tools");
    }
    const args = JSON.parse(input === "-" ? readStdin() : input || "{}");
    const result = await evaluate(
      page,
      `(async () => {
        const tool = (await document.modelContext.getTools()).find((t) => t.name === ${JSON.stringify(tool)});
        if (!tool) throw new Error('no WebMCP tool named ' + ${JSON.stringify(tool)});
        return document.modelContext.executeTool(tool, ${JSON.stringify(args)});
      })()`,
    );
    // Tools answer with a JSON string of MCP content; print the text parts.
    let parsed = result;
    try {
      parsed = typeof result === "string" ? JSON.parse(result) : result;
    } catch {}
    const text = parsed?.content?.filter((c) => c.type === "text").map((c) => c.text);
    console.log(text?.length ? text.join("\n") : typeof result === "string" ? result : JSON.stringify(result, null, 2));
  });

commands.devtools = () =>
  withTab(async ({ cdp, targetId }) => {
    const t = (await pages(cdp)).find((p) => p.targetId === targetId);
    console.log(`Watch or debug this tab ("${t.title || t.url}") from your Chrome:
  chrome://inspect/#devices → Configure… → add localhost:${INSPECT_PORT} → inspect
or paste this into the address bar:
  devtools://devtools/bundled/inspector.html?ws=127.0.0.1:${INSPECT_PORT}/devtools/page/${targetId}`);
  });

// ── Recording ───────────────────────────────────────────────────────────────

commands.record = async ([action, file], flags) => {
  const existing = activeRecording();
  if (action === "start") {
    if (existing) fail(`already recording to ${existing.out}; run \`wb record stop\` first`);
    const out = path.resolve(file || defaultArtifact("mp4"));
    if (!/\.(mp4|webm)$/.test(out)) fail("recordings must end in .mp4 or .webm");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const targetId = await withTab(async ({ targetId }) => targetId);
    fs.mkdirSync(RECORDINGS, { recursive: true });
    const log = fs.openSync(path.join(STATE, "recorder.log"), "a");
    const child = spawn(process.execPath, [SELF, "__record", targetId, out, String(flags.fps || 30)], {
      detached: true,
      stdio: ["ignore", log, log],
    });
    child.unref();
    // The recorder writes its record once frames are flowing.
    for (let i = 0; i < 40; i++) {
      await sleep(100);
      if (activeRecording()?.pid === child.pid) return console.log(`recording to ${out}`);
      if (!alive(child.pid)) break;
    }
    fail(`the recorder didn't start; see ${path.join(STATE, "recorder.log")}`);
  }
  if (action === "stop") {
    if (!existing) fail("not recording");
    const { pid, out, started } = existing;
    process.kill(pid, "SIGTERM");
    for (let i = 0; i < 600 && alive(pid); i++) await sleep(100);
    if (!fs.existsSync(out)) fail(`the recorder exited without writing ${out}; see ${path.join(STATE, "recorder.log")}`);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    return console.log(`${out}  (${seconds}s, ${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
  }
  if (action === "status") return console.log(existing ? `recording to ${existing.out}` : "not recording");
  fail("usage: wb record start [file.mp4|file.webm] [--fps 30] | wb record stop | wb record status");
};

// Runs detached: screencast frames from one tab into ffmpeg, at a steady frame rate.
async function recorder(targetId, out, fps) {
  const version = await hostVersion();
  if (!version) throw new WbError("Chrome isn't running");
  const cdp = await CDP.connect(version.webSocketDebuggerUrl);
  let sessionId;
  const page = (method, params) => cdp.send(method, params, sessionId);
  const codec = out.endsWith(".webm")
    ? ["-c:v", "libvpx", "-b:v", "4M"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
  let stopping = false;
  let ffmpeg = null;
  let ffmpegDone = null;
  // The video takes the first frame's size; frames of another size (wb viewport,
  // a popup window) are fitted inside it rather than stretched.
  const startFfmpeg = ({ width, height }) => {
    const w = Math.ceil(width / 2) * 2;
    const h = Math.ceil(height / 2) * 2;
    ffmpeg = spawn(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "-",
        "-vf", `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`, ...codec, out],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    // If ffmpeg dies (unwritable path, full disk), give up instead of hanging.
    ffmpegDone = new Promise((resolve) => ffmpeg.on("exit", resolve));
    ffmpegDone.then((code) => {
      if (stopping) return;
      console.error(`ffmpeg exited (${code}) while recording ${out}`);
      fs.rmSync(recordingFile(), { force: true });
      process.exit(1);
    });
  };
  let frame = null;
  cdp.on((m) => {
    if (m.sessionId !== sessionId || m.method !== "Page.screencastFrame") return;
    frame = Buffer.from(m.params.data, "base64");
    if (!ffmpeg) startFfmpeg(jpegSize(frame));
    page("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {});
  });
  const record = async (id) => {
    if (sessionId) cdp.send("Target.detachFromTarget", { sessionId }).catch(() => {});
    ({ sessionId } = await cdp.send("Target.attachToTarget", { targetId: id, flatten: true }));
    targetId = id;
    await page("Page.startScreencast", { format: "jpeg", quality: 85, everyNthFrame: 1 });
  };
  await record(targetId);
  // Chrome only sends a frame when something repaints; repeat the last one to keep time.
  const timer = setInterval(() => frame && ffmpeg?.stdin.writable && ffmpeg.stdin.write(frame), 1000 / fps);
  fs.writeFileSync(recordingFile(), JSON.stringify({ pid: process.pid, out, started: Date.now() }));
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    ffmpeg?.stdin.end();
    await ffmpegDone;
    fs.rmSync(recordingFile(), { force: true });
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  // Follow the agent: record whichever tab is its current one, and finish the
  // file once it has none left (wb close --all) or the browser stops.
  setInterval(() => {
    if (stopping) return;
    const { current } = readOwner();
    if (!current) return stop();
    if (current !== targetId) record(current).catch(() => {});
  }, 300);
  cdp.ws.addEventListener("close", stop);
}

// A JPEG's size, from its start-of-frame marker.
function jpegSize(jpeg) {
  for (let i = 2; i + 9 < jpeg.length; i += 2 + jpeg.readUInt16BE(i + 2)) {
    if (jpeg[i] !== 0xff) break;
    if (jpeg[i + 1] >= 0xc0 && jpeg[i + 1] <= 0xc2) return { height: jpeg.readUInt16BE(i + 5), width: jpeg.readUInt16BE(i + 7) };
  }
  throw new WbError("screencast frame isn't a JPEG");
}

// ── Signing in ──────────────────────────────────────────────────────────────

commands.signin = async (urls) => {
  if (process.platform !== "darwin" && !process.env.DISPLAY)
    fail("signing in needs a screen: run `wb signin` on your Mac, then `wb sync <this host>` there");
  if (signingIn()) fail("already signing in: finish in the Chrome window and quit it (⌘Q)");
  if (readdirSafe(RECORDINGS).some((f) => activeRecording(path.join(RECORDINGS, f))))
    fail("an agent is recording; wait for it to finish");
  // Take the lock first, so no agent restarts the headless browser on this profile meanwhile.
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(SIGNIN, JSON.stringify({ wb: process.pid }));
  const stopped = await stopHost();
  const start = urls.length ? urls : ["https://ground.beta.team/"];
  const has1Password = fs.existsSync(path.join(PROFILE, "Default/Extensions", ONEPASSWORD));
  if (!has1Password) start.push(`https://chromewebstore.google.com/detail/${ONEPASSWORD}`);
  // A normal window on the same profile, with extensions on and no debugging
  // port, so no agent can drive it while 1Password is unlocked in it.
  const chrome = spawn(CHROME, [`--user-data-dir=${PROFILE}`, ...COMMON_FLAGS, ...start], { stdio: "ignore" });
  fs.writeFileSync(SIGNIN, JSON.stringify({ wb: process.pid, chrome: chrome.pid }));
  console.log(`A Chrome window opened on the agents' profile${stopped ? " (agents' tabs were closed)" : ""}.
${has1Password ? "" : "First add 1Password from the Chrome Web Store tab and sign in to it.\n"}Sign in to what agents need (Ground, GitLab, Linear, AMPECO, …), then quit this Chrome (⌘Q).`);
  await new Promise((r) => chrome.on("exit", r));
  fs.rmSync(SIGNIN, { force: true });
  await ensureHost();
  console.log("Signed in. Agents' browser is running headless again.");
};

function readdirSafe(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

// ── Moving sessions between machines ────────────────────────────────────────

const COOKIE_FIELDS = ["name", "value", "domain", "path", "secure", "httpOnly", "sameSite", "priority", "sourceScheme", "sourcePort", "partitionKey"];

// JavaScript on a throwaway background tab at url, for that site's localStorage.
async function onSite(cdp, url, expression) {
  const { targetId } = await cdp.send("Target.createTarget", { url, newWindow: true, background: true });
  try {
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const page = (method, params) => cdp.send(method, params, sessionId);
    const origin = new URL(url).origin;
    for (let i = 0; (await evaluate(page, "location.origin").catch(() => null)) !== origin; i++) {
      if (i === 100) fail(`couldn't load ${url}`);
      await sleep(100);
    }
    return await evaluate(page, expression);
  } finally {
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

// The receiving half of `wb sync`, run over ssh on the other machine.
commands.__import = async () => {
  const { version, cookies, storage, from, exportedAt } = JSON.parse(readStdin());
  if (version !== 1 || !Array.isArray(cookies)) fail("expected the cookies `wb sync` sends");
  const params = cookies.map((c) => {
    const p = Object.fromEntries(COOKIE_FIELDS.filter((k) => c[k] !== undefined).map((k) => [k, c[k]]));
    if (!c.session && c.expires > 0) p.expires = c.expires;
    return p;
  });
  await restartIfUpdated();
  const items = Object.entries(storage);
  await withBrowser(async (cdp) => {
    await cdp.send("Storage.setCookies", { cookies: params });
    if (items.length)
      await onSite(cdp, SYNC_STORAGE.url, `for (const [k, v] of ${JSON.stringify(items)}) localStorage.setItem(k, v)`);
  });
  console.log(`imported ${params.length} cookies and ${items.length} Linear settings from ${from} (${exportedAt})`);
};

commands.sync = async ([host]) => {
  if (!host) fail("usage: wb sync <ssh host>");
  await restartIfUpdated();
  const { cookies, storage } = await withBrowser(async (cdp) => ({
    cookies: (await cdp.send("Storage.getCookies")).cookies.filter((c) => SYNC_DOMAINS.test(c.domain)),
    storage: await onSite(cdp, SYNC_STORAGE.url,
      `Object.fromEntries(${JSON.stringify(SYNC_STORAGE.keys)}.map((k) => [k, localStorage.getItem(k)]).filter(([, v]) => v !== null))`),
  }));
  const data = JSON.stringify({ version: 1, from: os.hostname(), exportedAt: new Date().toISOString(), cookies, storage });
  const ssh = spawn("ssh", [host, "bash -lc '~/dotfiles/bin/wb __import'"], { stdio: ["pipe", "inherit", "inherit"] });
  ssh.stdin.end(data);
  const code = await new Promise((r) => ssh.on("close", r));
  if (code !== 0) fail(`ssh ${host} exited with ${code}`);
};

// ── Housekeeping ────────────────────────────────────────────────────────────

commands.status = async () => {
  const version = await hostVersion();
  const signin = signingIn();
  console.log(`browser   ${version ? `${version.Browser}, headless on 127.0.0.1:${PORT}` : signin ? "signing in (window open)" : "not running (starts on first use)"}`);
  console.log(`profile   ${PROFILE}`);
  const owners = readdirSafe(OWNERS);
  console.log(`agents    ${owners.length} with tabs${owners.includes(`${OWNER}.json`) ? ` (including you: ${readOwner().tabs.length} tabs)` : ""}`);
  const recordings = readdirSafe(RECORDINGS).filter((f) => activeRecording(path.join(RECORDINGS, f)));
  console.log(`recording ${recordings.length ? recordings.map((f) => f.replace(/\.json$/, "")).join(", ") : "none"}`);
};

commands.start = async () => {
  const version = await ensureHost();
  console.log(`${version.Browser} on 127.0.0.1:${PORT}`);
};

commands.stop = async () => console.log((await stopHost()) ? "stopped" : "not running");

const HELP = `wb: a headless Google Chrome for agents, signed in once. Each agent only sees its own tabs.

  wb open <url> [--new-tab]       go to a URL in your current tab (opens one if needed)
  wb snapshot [--limit N]         numbered interactive elements: @1, @2, …
  wb click <target>               target: @N, text=Label, or a CSS selector
  wb type <target> <text>         replace the field's text (--append to add; - reads stdin)
  wb press <key>                  Enter, Tab, Escape, ArrowDown, …
  wb wait <target>                or --url <part>; --timeout ms (default 15000)
  wb eval '<js>'                  run JavaScript in the page (- reads stdin)
  wb screenshot [file.png]        --full for the whole page, --element <target> for one element
  wb record start [file.mp4]      record what you do (it follows you to new tabs); wb record stop
  wb viewport <width> <height>    resize your tab's page (at least 500 wide)
  wb console [--clear]            console messages and errors from your tab
  wb webmcp [tool] [json]         list or call the page's WebMCP tools
  wb devtools                     how to watch or debug your tab from your Chrome
  wb tabs | wb tab <n> | wb close [--all]
  wb status | wb start | wb stop
  wb signin [url…]                sign in, in a normal Chrome window on the agents' profile
  wb sync <ssh host>              copy BETA app and Linear sessions to another machine's wb`;

// ── Main ────────────────────────────────────────────────────────────────────

function parse(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-" || !arg.startsWith("--")) positional.push(arg);
    else if (["--fps", "--timeout", "--limit", "--element", "--url"].includes(arg)) flags[arg.slice(2)] = argv[++i];
    else flags[arg.slice(2)] = true;
  }
  return { positional, flags };
}

// A reader that stops early (`wb snapshot | head`) isn't an error.
process.stdout.on("error", (error) => process.exit(error.code === "EPIPE" ? 0 : 1));

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "__record") await recorder(rest[0], rest[1], Number(rest[2]));
  else if (!command || command === "help" || command === "--help") console.log(HELP);
  else if (!commands[command]) fail(`unknown command: ${command}\n\n${HELP}`);
  else {
    const { positional, flags } = parse(rest);
    await commands[command](positional, flags);
    // process.exit drops output still queued for a pipe (the bash tool's, or ssh's).
    await new Promise((resolve) => process.stdout.write("", resolve));
    process.exit(0);
  }
} catch (error) {
  console.error(`wb: ${error instanceof WbError ? error.message : error.stack}`);
  process.exit(1);
}
