/**
 * compaction-throttle.js
 *
 * 维护 context compaction 的防震荡状态：
 * 1. 按 session 记录最近压缩收益。
 * 2. 连续两次节省比例小于 10% 时进入 cooldown。
 * 3. check() 在 cooldown 期间返回 false，调用方可跳过本次压缩。
 *
 * 设计目标：
 * - 使用 fs.promises 持久化状态，插件重启后依然生效。
 * - 仅依赖 Node.js 内置模块。
 * - API 保持简单：check() / record()。
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'compaction-throttle.json');
const LOW_SAVING_THRESHOLD = 0.10;
const LOW_SAVING_STREAK_LIMIT = 2;
const COOLDOWN_MS = 30 * 60 * 1000;

let cachedState = null;

/**
 * 读取节流状态；文件不存在时返回默认结构。
 */
async function loadState() {
  if (cachedState) {
    return cachedState;
  }

  try {
    const raw = await fs.promises.readFile(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    cachedState = normalizeState(parsed);
    return cachedState;
  } catch (error) {
    cachedState = normalizeState(null);
    return cachedState;
  }
}

/**
 * 持久化状态；失败时仅记录到 stderr，不抛出到主流程。
 */
async function saveState(state) {
  cachedState = normalizeState(state);
  try {
    await fs.promises.writeFile(
      STATE_FILE,
      JSON.stringify(cachedState, null, 2) + '\n',
      'utf-8'
    );
  } catch (error) {
    console.error(`[skills-evolution] compaction throttle save error: ${error.message}`);
  }
}

/**
 * 判断当前 session 是否允许继续触发压缩。
 * 返回 true 表示允许压缩；false 表示命中 cooldown。
 */
async function check(signal = {}) {
  const state = await loadState();
  const sessionKey = normalizeSessionKey(signal.sessionKey);
  const session = getSessionState(state, sessionKey);
  const now = Date.now();

  // tokenCount 当前只作为接口的一部分保留，后续可用于更精细的阈值策略。
  session.lastSeenTokenCount = Number(signal.tokenCount || 0);
  session.lastCheckAt = now;

  if (session.cooldownUntil && session.cooldownUntil > now) {
    await saveState(state);
    return false;
  }

  if (session.cooldownUntil && session.cooldownUntil <= now) {
    session.cooldownUntil = 0;
    session.lowSavingStreak = 0;
  }

  await saveState(state);
  return true;
}

/**
 * 记录一次压缩前后 token 变化，并在连续低收益时进入 cooldown。
 */
async function record(result = {}) {
  const state = await loadState();
  const sessionKey = normalizeSessionKey(result.sessionKey);
  const session = getSessionState(state, sessionKey);
  const tokenBefore = Math.max(0, Number(result.estimatedOriginalTokens || 0));
  const tokenAfter = Math.max(0, Number(result.compressedTokens || 0));
  const now = Date.now();

  if (tokenBefore <= 0 || tokenAfter > tokenBefore) {
    session.lastRecordedAt = now;
    await saveState(state);
    return;
  }

  const savedRatio = tokenBefore === 0 ? 0 : (tokenBefore - tokenAfter) / tokenBefore;
  session.lastRecordedAt = now;
  session.lastSavingRatio = Number(savedRatio.toFixed(4));

  if (savedRatio < LOW_SAVING_THRESHOLD) {
    session.lowSavingStreak = Number(session.lowSavingStreak || 0) + 1;
  } else {
    session.lowSavingStreak = 0;
    session.cooldownUntil = 0;
  }

  if (session.lowSavingStreak >= LOW_SAVING_STREAK_LIMIT) {
    session.cooldownUntil = now + COOLDOWN_MS;
  }

  await saveState(state);
}

function normalizeState(value) {
  return {
    sessions: value && typeof value === 'object' && value.sessions && typeof value.sessions === 'object'
      ? value.sessions
      : {}
  };
}

function normalizeSessionKey(sessionKey) {
  return String(sessionKey || 'global');
}

function getSessionState(state, sessionKey) {
  if (!state.sessions[sessionKey] || typeof state.sessions[sessionKey] !== 'object') {
    state.sessions[sessionKey] = {
      cooldownUntil: 0,
      lowSavingStreak: 0,
      lastSavingRatio: null,
      lastSeenTokenCount: 0,
      lastCheckAt: 0,
      lastRecordedAt: 0
    };
  }
  return state.sessions[sessionKey];
}

module.exports = {
  check,
  record,
  STATE_FILE
};
