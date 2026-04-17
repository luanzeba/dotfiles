import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const STATE_FILE = join(homedir(), ".cache", "agent-web", "session.json");

function defaultState() {
  return {
    ownedTargetIds: [],
    activeTargetId: null,
    updatedAt: null,
  };
}

function normalizeState(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  const ownedTargetIds = Array.isArray(state.ownedTargetIds)
    ? [...new Set(state.ownedTargetIds.filter((id) => typeof id === "string" && id.length > 0))]
    : [];

  const activeTargetId =
    typeof state.activeTargetId === "string" && state.activeTargetId.length > 0
      ? state.activeTargetId
      : null;

  return {
    ownedTargetIds,
    activeTargetId,
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : null,
  };
}

function ensureStateDir() {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
}

function writeState(state) {
  ensureStateDir();
  const next = {
    ...normalizeState(state),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

function sameArray(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function loadSessionState() {
  if (!existsSync(STATE_FILE)) {
    return defaultState();
  }

  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    return normalizeState(raw);
  } catch {
    return defaultState();
  }
}

export function rememberOwnedTarget(targetId) {
  if (!targetId) return loadSessionState();

  const state = loadSessionState();
  const ownedTargetIds = state.ownedTargetIds.includes(targetId)
    ? state.ownedTargetIds
    : [...state.ownedTargetIds, targetId];

  return writeState({
    ...state,
    ownedTargetIds,
    activeTargetId: targetId,
  });
}

export function setActiveTarget(targetId) {
  if (!targetId) return loadSessionState();

  const state = loadSessionState();
  const ownedTargetIds = state.ownedTargetIds.includes(targetId)
    ? state.ownedTargetIds
    : [...state.ownedTargetIds, targetId];

  return writeState({
    ...state,
    ownedTargetIds,
    activeTargetId: targetId,
  });
}

export function forgetOwnedTarget(targetId) {
  if (!targetId) return loadSessionState();

  const state = loadSessionState();
  const ownedTargetIds = state.ownedTargetIds.filter((id) => id !== targetId);
  const activeTargetId = state.activeTargetId === targetId ? ownedTargetIds.at(-1) || null : state.activeTargetId;

  return writeState({
    ...state,
    ownedTargetIds,
    activeTargetId,
  });
}

function pruneStateToOpenTargets(state, pages) {
  const openTargetIds = new Set((pages || []).map((page) => page.targetId).filter(Boolean));

  const ownedTargetIds = state.ownedTargetIds.filter((id) => openTargetIds.has(id));
  const activeTargetId =
    state.activeTargetId && ownedTargetIds.includes(state.activeTargetId)
      ? state.activeTargetId
      : ownedTargetIds.at(-1) || null;

  const changed =
    !sameArray(ownedTargetIds, state.ownedTargetIds) || activeTargetId !== state.activeTargetId;

  const next = {
    ...state,
    ownedTargetIds,
    activeTargetId,
  };

  if (changed) {
    return writeState(next);
  }

  return next;
}

export function listOpenOwnedTargetIds(pages) {
  const state = pruneStateToOpenTargets(loadSessionState(), pages);
  return state.ownedTargetIds;
}

export function getPreferredOwnedTargetId(pages) {
  const state = pruneStateToOpenTargets(loadSessionState(), pages);
  return state.activeTargetId || null;
}
