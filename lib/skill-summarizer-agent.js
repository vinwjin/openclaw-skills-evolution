/**
 * skill-summarizer-agent.js
 * v0.5: 封装 spawn 子 Agent 的逻辑
 *
 * spawnDeepReview(sessionFile, workspace, skillName?)
 * - spawn deep-review-worker.js，不阻塞立即返回
 * - 维护 .pending-deep-reviews.json 队列
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const pendingFile = path.join(__dirname, '..', '.pending-deep-reviews.json');
const spoolDir = path.join(__dirname, '..', '.deep-review-spool');
const MAX_PENDING_DEEP_REVIEWS = 50;

// ============================================================================
// 核心方法
// ============================================================================

/**
 * Spawn 子 Agent 在后台做深度固化
 * @param {string} sessionFile - session JSONL 文件路径
 * @param {string} workspace - openclaw workspace 根目录
 * @param {string} [skillName] - 可选，指定 skill 名称
 * @returns {object} { pid, pendingId }
 */
function spawnDeepReview(sessionFile, workspace, skillName) {
  const pendingReviews = getPendingReviews();
  // 限制后台并发队列长度，避免大量 session 持续堆积拖垮进程。
  if (pendingReviews.length >= MAX_PENDING_DEEP_REVIEWS) {
    throw new Error(`too many pending deep reviews (limit: ${MAX_PENDING_DEEP_REVIEWS})`);
  }

  const pendingId = `dr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workerSessionFile = copySessionFileToSpool(sessionFile, pendingId);

  // 1. 加入 pending 队列
  pendingReviews.push({
    id: pendingId,
    sessionFile,
    workerSessionFile,
    workspace,
    skillName: skillName || null,
    spawnedAt: new Date().toISOString()
  });
  writePending(pendingReviews);

  // 2. Spawn 子进程
  const workerScript = path.join(__dirname, '..', 'scripts', 'deep-review-worker.js');

  const args = [
    '--session-file', workerSessionFile,
    '--source-session-file', sessionFile,
    '--pending-id', pendingId,
    '--workspace', workspace
  ];
  if (skillName) {
    args.push('--skill-name', skillName);
  }

  const child = spawn(process.execPath, [workerScript, ...args], {
    detached: true,
    stdio: 'ignore'
  });

  child.unref();

  console.error(`[skill-summarizer-agent] spawned deep-review ${pendingId}, pid=${child.pid}`);

  return { pid: child.pid, pendingId };
}

/**
 * 读取 pending 队列
 */
function getPendingReviews() {
  try {
    if (!fs.existsSync(pendingFile)) return [];
    const raw = fs.readFileSync(pendingFile, 'utf-8');
    const parsed = JSON.parse(raw);
    const normalized = normalizePendingReviews(Array.isArray(parsed) ? parsed : []);
    if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
      writePending(normalized);
    }
    return normalized;
  } catch {
    return [];
  }
}

/**
 * 读取 done 记录（.deep-review-done.json）
 */
function getDoneReviews() {
  const doneFile = path.join(__dirname, '..', '.deep-review-done.json');
  try {
    if (!fs.existsSync(doneFile)) return [];
    const raw = fs.readFileSync(doneFile, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ============================================================================
// Private helpers
// ============================================================================

function removePending(id) {
  let records = getPendingReviews();
  records = records.filter(r => r.id !== id);
  writePending(records);
}

function copySessionFileToSpool(sessionFile, pendingId) {
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    throw new Error(`session file not found: ${sessionFile}`);
  }

  fs.mkdirSync(spoolDir, { recursive: true });
  const spoolPath = path.join(spoolDir, `${pendingId}.jsonl`);
  fs.copyFileSync(sessionFile, spoolPath);
  return spoolPath;
}

function normalizePendingReviews(records) {
  const completed = getCompletedReviewPaths();

  return records.filter(record => {
    if (!record || typeof record !== 'object') return false;

    const workerSessionFile = typeof record.workerSessionFile === 'string' ? record.workerSessionFile : '';
    const sessionFile = typeof record.sessionFile === 'string' ? record.sessionFile : '';
    if (workerSessionFile && completed.workerFiles.has(workerSessionFile)) {
      return false;
    }
    if (!workerSessionFile && sessionFile && completed.sessionFiles.has(sessionFile)) {
      return false;
    }

    if (workerSessionFile && fs.existsSync(workerSessionFile)) {
      return true;
    }
    if (sessionFile && fs.existsSync(sessionFile)) {
      return true;
    }
    return false;
  });
}

function getCompletedReviewPaths() {
  const doneReviews = getDoneReviews();
  const sessionFiles = new Set();
  const workerFiles = new Set();

  for (const review of doneReviews) {
    const status = String(review?.status || 'completed');
    if (status !== 'completed' && status !== 'failed') continue;

    if (typeof review?.sessionFile === 'string' && review.sessionFile) {
      sessionFiles.add(review.sessionFile);
    }
    if (typeof review?.workerSessionFile === 'string' && review.workerSessionFile) {
      workerFiles.add(review.workerSessionFile);
    }
  }

  return { sessionFiles, workerFiles };
}

function writePending(records) {
  try {
    fs.writeFileSync(pendingFile, JSON.stringify(records, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.error(`[skill-summarizer-agent] failed to write pending: ${err.message}`);
  }
}

module.exports = { spawnDeepReview, getPendingReviews, getDoneReviews, removePending };
