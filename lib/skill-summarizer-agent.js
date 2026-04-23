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
  const pendingId = `dr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 1. 加入 pending 队列
  addPending({
    id: pendingId,
    sessionFile,
    workspace,
    skillName: skillName || null,
    spawnedAt: new Date().toISOString()
  });

  // 2. Spawn 子进程
  const workerScript = path.join(__dirname, '..', 'scripts', 'deep-review-worker.js');

  const args = [
    '--session-file', sessionFile,
    '--workspace', workspace
  ];
  if (skillName) {
    args.push('--skill-name', skillName);
  }

  const child = spawn('node', [workerScript, ...args], {
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
    return Array.isArray(parsed) ? parsed : [];
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

function addPending(record) {
  let records = getPendingReviews();
  records.push(record);
  writePending(records);
}

function removePending(id) {
  let records = getPendingReviews();
  records = records.filter(r => r.id !== id);
  writePending(records);
}

function writePending(records) {
  try {
    fs.writeFileSync(pendingFile, JSON.stringify(records, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.error(`[skill-summarizer-agent] failed to write pending: ${err.message}`);
  }
}

module.exports = { spawnDeepReview, getPendingReviews, getDoneReviews };