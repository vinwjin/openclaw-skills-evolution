/**
 * deep-review-worker.js
 * v0.5: 子 Agent 后台固化入口脚本
 *
 * 独立可执行 node 脚本，接收参数：
 *   --session-file <path>   session JSONL 文件
 *   --workspace <path>      openclaw workspace 根目录
 *   --skill-name <name>     可选，指定 skill 名称
 *
 * 流程：读取 session JSONL → 生成摘要 → 生成 SKILL.md 内容 → 写入 skills 目录
 * 完成后写入 .deep-review-done.json 记录结果
 */

const fs = require('fs');
const path = require('path');
const { SkillSaver } = require('../lib/skill-saver');
const MAX_SESSION_FILE_SIZE = 10 * 1024 * 1024;
const MAX_SESSION_LINES = 10000;
const MAX_LINE_LENGTH = 10000;
const MAX_FINDINGS = 5;
const MAX_ACTION_STEPS = 8;
const MAX_VERIFICATION_STEPS = 4;
const MAX_NOTES = 5;
const SHELL_LANGS = new Set(['bash', 'console', 'fish', 'powershell', 'ps1', 'shell', 'sh', 'zsh']);
const SECRET_PATTERNS = [
  /\bapi[_-]?key\b/i,
  /\btoken\b/i,
  /\bpassword\b/i,
  /\bbearer\b/i,
  /\bsecret\b/i,
  /\bprivate\b/i,
  /\bsk-[a-z0-9]{10,}\b/i
];
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+previous\s+instructions/i,
  /call\s+skill_manage/i,
  /system\s+prompt/i
];
const LOW_VALUE_TOPIC_PATTERNS = [
  /^a new session was started via \/new or \/reset/i,
  /^hello[,!\s].*help me with coding/i,
  /^\/tools\b/i,
  /^\s*system:/i,
  /\b(smoke|live|provider|payload)_ready\b/i,
  /\bsecrets?_reloader_degraded\b/i,
  /\bsecret resolution\b/i,
  /write a dream diary entry/i,
  /请回复[:：]/i
];

// ============================================================================
// CLI 参数解析
// ============================================================================

// ============================================================================
// 日志
// ============================================================================

const logFile = path.join(__dirname, '..', '.deep-review-worker.log');

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
  console.error(line.trim());
}

// ============================================================================
// 核心流程
// ============================================================================

async function main() {
  const pendingDoneFile = path.join(__dirname, '..', '.deep-review-done.json');
  const parsedArgs = parseCliArgs(process.argv.slice(2));
  let { sessionFile, workspace, skillName, sourceSessionFile, pendingId } = parsedArgs;

  if (!sessionFile || !workspace) {
    console.error('Usage: node deep-review-worker.js --session-file <path> --workspace <path> [--skill-name <name>]');
    process.exit(1);
  }

  workspace = path.resolve(workspace);
  sourceSessionFile = sourceSessionFile || sessionFile;

  log(`Starting deep-review-worker: sessionFile=${sourceSessionFile}, workspace=${workspace}, skillName=${skillName || 'auto'}`);

  try {
    // 1. 读取 session JSONL
    if (!fs.existsSync(sessionFile)) {
      throw new Error(`session file not found: ${sessionFile}`);
    }

    const sessionStat = await fs.promises.stat(sessionFile);
    // 大文件直接拒绝，避免后台 worker 读取异常 session 时耗尽资源。
    if (sessionStat.size > MAX_SESSION_FILE_SIZE) {
      throw new Error(`session file too large: ${sessionStat.size} bytes`);
    }

    const raw = await fs.promises.readFile(sessionFile, 'utf-8');
    const lines = raw
      .split('\n')
      .slice(0, MAX_SESSION_LINES)
      .map(line => line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) : line)
      .filter(l => l.trim());
    const entries = lines.map(l => {
      try { return JSON.parse(l); }
      catch { return null; }
    }).filter(Boolean);

    if (entries.length === 0) {
      throw new Error('session file is empty');
    }

    log(`Parsed ${entries.length} session entries`);

    // 2. 提取 session 内容
    const sessionData = extractSessionData(entries);
    log(`Session parsed: topicLength=${sessionData.topic.length}, tools=${sessionData.tools.length}, findings=${sessionData.findings.length}`);

    const skipReason = getSkipReason(sessionData);
    if (skipReason) {
      await appendDoneRecord(pendingDoneFile, {
        ...(pendingId ? { pendingId } : {}),
        sessionFile: sourceSessionFile,
        workerSessionFile: sessionFile,
        skillName: skillName || null,
        reason: skipReason,
        findingsCount: sessionData.findings.length,
        toolCount: sessionData.tools.length,
        completedAt: new Date().toISOString(),
        status: 'skipped'
      });
      log(`Skipped deep review: ${skipReason}`);
      cleanupPendingState(pendingId, sessionFile, sourceSessionFile);
      return;
    }

    // 3. 生成 skill 名称（如果未指定）
    const finalSkillName = skillName || generateSkillName(sessionData.topic);

    // 4. 生成 SKILL.md 内容
    const skillContent = buildSkillMarkdown(sessionData, finalSkillName);

    // 5. 写入 skills 目录
    const saver = new SkillSaver();
    const { safeName, filePath } = await saver.save(workspace, {
      name: finalSkillName,
      content: skillContent
    });

    log(`Skill written to: ${filePath}`);

    // 6. 记录完成状态到 .deep-review-done.json
    const doneRecord = {
      ...(pendingId ? { pendingId } : {}),
      skillName: finalSkillName,
      safeName,
      sessionFile: sourceSessionFile,
      workerSessionFile: sessionFile,
      // done 记录只保留结构化元信息，避免写入原始 session 片段。
      findingsCount: sessionData.findings.length,
      toolCount: sessionData.tools.length,
      completedAt: new Date().toISOString(),
      filePath,
      status: 'completed'
    };

    await appendDoneRecord(pendingDoneFile, doneRecord);

    log(`Recorded to .deep-review-done.json`);
    log('Deep review completed successfully.');
    cleanupPendingState(pendingId, sessionFile, sourceSessionFile);

  } catch (err) {
    log(`ERROR: ${err.message}`);
    // 记录失败状态
    const failRecord = {
      ...(pendingId ? { pendingId } : {}),
      sessionFile: sourceSessionFile,
      workerSessionFile: sessionFile,
      skillName: skillName || null,
      error: err.message,
      completedAt: new Date().toISOString()
    };

    await appendDoneRecord(pendingDoneFile, { ...failRecord, status: 'failed' });
    cleanupPendingState(pendingId, sessionFile, sourceSessionFile);

    process.exit(1);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function extractSessionData(entries) {
  const messages = entries
    .filter(e => e.type === 'message' && e.message)
    .map(e => e.message);

  const userMsgs = messages.filter(m => m.role === 'user');
  const assistantMsgs = messages.filter(m => m.role === 'assistant');
  const assistantTexts = assistantMsgs.flatMap(message => getTextBlocks(message));

  // 提取工具调用
  const toolCalls = assistantMsgs.flatMap(m => {
    const blocks = Array.isArray(m.content) ? m.content : [];
    return blocks.filter(b => b.type === 'toolCall');
  });

  const toolNames = new Set();
  for (const tc of toolCalls) {
    const name = tc.name || tc.toolName || tc.tool?.name || '';
    if (name) toolNames.add(name);
    if (tc.toolCalls) {
      for (const nested of tc.toolCalls) {
        const n = nested.name || nested.toolName || '';
        if (n) toolNames.add(n);
      }
    }
  }

  // 提取主题
  const topic = extractTopic(userMsgs);

  // 提取关键发现（代码片段）
  const findings = [];
  for (const text of assistantTexts) {
    const codeBlocks = text.match(/```[\s\S]*?```/g) || [];
    for (const block of codeBlocks.slice(0, 3)) {
      const firstLine = sanitizeFinding(block.split('\n')[1] || '');
      if (firstLine) {
        findings.push(firstLine);
      }
    }
  }

  return {
    topic,
    tools: Array.from(toolNames),
    findings: dedupeStrings(findings).slice(0, MAX_FINDINGS),
    actionSteps: buildActionSteps(assistantTexts, toolCalls, topic),
    verificationSteps: buildVerificationSteps(assistantTexts, toolCalls),
    notes: buildNotes(assistantTexts, findings)
  };
}

function parseCliArgs(args) {
  const parsed = {
    sessionFile: null,
    workspace: null,
    skillName: null,
    sourceSessionFile: null,
    pendingId: null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--session-file' && i + 1 < args.length) {
      parsed.sessionFile = args[++i];
    } else if (args[i] === '--workspace' && i + 1 < args.length) {
      parsed.workspace = args[++i];
    } else if (args[i] === '--skill-name' && i + 1 < args.length) {
      parsed.skillName = args[++i];
    } else if (args[i] === '--source-session-file' && i + 1 < args.length) {
      parsed.sourceSessionFile = args[++i];
    } else if (args[i] === '--pending-id' && i + 1 < args.length) {
      parsed.pendingId = args[++i];
    }
  }

  return parsed;
}

function generateSkillName(topic) {
  // 从 topic 生成一个描述性名称
  const words = normalizeTopic(topic)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 4);

  if (words.length === 0) return 'session-skill';

  // 转换为 camelCase
  return words.map((w, i) =>
    i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)
  ).join('') + 'Skill';
}

function buildSkillMarkdown(data, name) {
  const { topic, tools, findings, notes } = data;
  const workflowSteps = buildWorkflowSteps(data);
  const verificationSteps = data.verificationSteps.length > 0
    ? data.verificationSteps
    : ['Confirm the final artifact or behavior matches the task goal before you close the loop.'];
  const whenToUse = [
    `Use this skill when the task matches: **${topic}**.`
  ];
  if (tools.length > 0) {
    whenToUse.push(`Expect to lean on ${tools.slice(0, 4).map(tool => `\`${tool}\``).join(', ')} during execution.`);
  }

  const actionLabels = inferActions(data);

  return `---
name: ${JSON.stringify(name)}
description: ${JSON.stringify(`Reusable workflow distilled from a session about: ${topic}`)}
triggers:
  - ${JSON.stringify(topic)}
actions:
${actionLabels.map(action => `  - ${JSON.stringify(action)}`).join('\n')}
---

# ${name}

## When To Use

${whenToUse.map(line => `- ${line}`).join('\n')}

## Workflow

${workflowSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}

## Verification

${verificationSteps.map(step => `- ${step}`).join('\n')}

## Notes

${buildNotesSection(findings, notes)}
`;
}

function extractTopic(userMessages) {
  const texts = userMessages
    .flatMap(message => getTextBlocks(message))
    .map(text => collapseWhitespace(text));
  const primary = texts.find(text => text && !/^\s*system:/i.test(text)) || texts[0] || 'Unknown';
  return normalizeTopic(primary);
}

function normalizeTopic(topic) {
  const normalized = collapseWhitespace(
    String(topic || '')
      .replace(/^system:\s*/i, '')
      .replace(/^\[[^\]]+\]\s*/g, '')
      .replace(/^\([^)]+\)\s*/g, '')
      .replace(/^\s*[-:]+\s*/g, '')
  );
  return normalized || 'Unknown';
}

function buildActionSteps(texts, toolCalls, topic) {
  const steps = [];

  for (const text of texts) {
    for (const step of extractStructuredSteps(text)) {
      if (isVerificationStep(step)) continue;
      steps.push(step);
    }
  }

  for (const toolCall of toolCalls) {
    const step = describeToolCall(toolCall);
    if (step && !isVerificationStep(step)) {
      steps.push(step);
    }
  }

  const deduped = dedupeStrings(steps).slice(0, MAX_ACTION_STEPS);
  if (deduped.length > 0) {
    return deduped;
  }

  return [
    `Review the task goal and concrete constraints: ${topic}.`
  ];
}

function buildVerificationSteps(texts, toolCalls) {
  const steps = [];

  for (const text of texts) {
    for (const step of extractStructuredSteps(text)) {
      if (isVerificationStep(step)) {
        steps.push(step);
      }
    }
  }

  for (const toolCall of toolCalls) {
    const command = extractToolCommand(toolCall);
    if (command && looksLikeVerificationCommand(command)) {
      steps.push(`Run \`${command}\` and confirm it passes cleanly.`);
    }
  }

  return dedupeStrings(steps).slice(0, MAX_VERIFICATION_STEPS);
}

function buildNotes(texts, findings) {
  const notes = [];

  for (const finding of findings) {
    if (finding !== '[REDACTED: sensitive finding]') {
      notes.push(`Key artifact observed in the source session: \`${finding}\`.`);
    }
  }

  for (const text of texts) {
    const plainText = text.replace(/```[\s\S]*?```/g, '\n');
    for (const rawLine of plainText.split(/\r?\n/)) {
      const cleaned = cleanStructuredLine(rawLine);
      if (!cleaned || looksLikeActionOrVerification(cleaned)) continue;
      if (cleaned.length > 160) continue;
      if (LOW_VALUE_TOPIC_PATTERNS.some(pattern => pattern.test(cleaned))) continue;
      notes.push(ensureSentence(cleaned));
    }
  }

  return dedupeStrings(notes).slice(0, MAX_NOTES);
}

function buildWorkflowSteps(data) {
  const steps = [];
  steps.push(`Review the task goal and scope: ${data.topic}.`);

  for (const step of data.actionSteps) {
    steps.push(ensureSentence(step));
  }

  if (steps.length < 3) {
    for (const finding of data.findings) {
      if (finding === '[REDACTED: sensitive finding]') continue;
      steps.push(`Apply the key implementation detail captured in the source session: \`${finding}\`.`);
      if (steps.length >= MAX_ACTION_STEPS) break;
    }
  }

  if (steps.length < 3 && data.tools.length > 0) {
    steps.push(`Use ${data.tools.slice(0, 4).map(tool => `\`${tool}\``).join(', ')} where direct inspection, editing, or execution is required.`);
  }

  return dedupeStrings(steps).slice(0, MAX_ACTION_STEPS);
}

function buildNotesSection(findings, notes) {
  const lines = [...notes];
  if (findings.includes('[REDACTED: sensitive finding]')) {
    lines.push('The source session included sensitive material; keep secrets and credentials out of any reusable artifact.');
  }
  if (lines.length === 0) {
    lines.push('Keep session-specific identifiers, timestamps, and one-off environment details out of the reusable workflow.');
  }
  return lines.map(line => `- ${ensureSentence(line)}`).join('\n');
}

function inferActions(data) {
  const actions = ['review context', 'execute workflow'];
  if (data.tools.length > 0) {
    actions.push('use tooling');
  }
  if (data.verificationSteps.length > 0) {
    actions.push('verify outcome');
  }
  return dedupeStrings(actions);
}

function getSkipReason(data) {
  if (!data || !data.topic || data.topic === 'Unknown') {
    return 'missing usable topic';
  }
  if (LOW_VALUE_TOPIC_PATTERNS.some(pattern => pattern.test(data.topic))) {
    return `low-value topic: ${data.topic}`;
  }

  const totalSignal = data.actionSteps.length + data.verificationSteps.length + data.findings.length + data.tools.length;
  if (totalSignal === 0) {
    return 'no reusable workflow signal found';
  }

  return null;
}

function extractStructuredSteps(text) {
  const steps = [];

  for (const match of text.matchAll(/```([a-z0-9_-]+)?\n([\s\S]*?)```/gi)) {
    const language = String(match[1] || '').toLowerCase();
    const body = String(match[2] || '');
    if (SHELL_LANGS.has(language) || looksLikeShellBlock(body)) {
      for (const line of body.split(/\r?\n/)) {
        const command = line.trim();
        if (!command || command.startsWith('#')) continue;
        if (looksLikeVerificationCommand(command)) {
          steps.push(`Run \`${command}\` and confirm it passes cleanly.`);
        } else {
          steps.push(`Run \`${command}\`.`);
        }
      }
    }
  }

  const plainText = text.replace(/```[\s\S]*?```/g, '\n');
  for (const rawLine of plainText.split(/\r?\n/)) {
    const cleaned = cleanStructuredLine(rawLine);
    if (!cleaned) continue;
    if (!looksLikeActionOrVerification(cleaned)) continue;
    steps.push(ensureSentence(cleaned));
  }

  return dedupeStrings(steps);
}

function describeToolCall(toolCall) {
  const toolName = extractToolName(toolCall).toLowerCase();
  const command = extractToolCommand(toolCall);
  const filePath = extractToolPath(toolCall);

  if (['exec', 'process', 'shell', 'terminal'].some(token => toolName.includes(token))) {
    if (!command) return null;
    if (looksLikeVerificationCommand(command)) {
      return `Run \`${command}\` and verify the result.`;
    }
    return `Run \`${command}\`.`;
  }

  if ((toolName.includes('read') || toolName.includes('open')) && filePath) {
    return `Inspect \`${filePath}\` before making follow-up changes.`;
  }

  if ((toolName.includes('write') || toolName.includes('edit') || toolName.includes('patch')) && filePath) {
    return `Update \`${filePath}\` with the required changes.`;
  }

  return null;
}

function extractToolCommand(toolCall) {
  const direct = firstNonEmptyString(
    toolCall?.command,
    toolCall?.cmd,
    toolCall?.input
  );
  if (direct) return collapseWhitespace(direct);

  const args = parseToolArgs(toolCall);
  return collapseWhitespace(firstNonEmptyString(
    args.command,
    args.cmd,
    args.input,
    args.script
  ));
}

function extractToolPath(toolCall) {
  const direct = firstNonEmptyString(
    toolCall?.path,
    toolCall?.filePath,
    toolCall?.file
  );
  if (direct) return collapseWhitespace(direct);

  const args = parseToolArgs(toolCall);
  return collapseWhitespace(firstNonEmptyString(
    args.path,
    args.filePath,
    args.file,
    args.target
  ));
}

function parseToolArgs(toolCall) {
  const raw = toolCall?.args ?? toolCall?.arguments;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function extractToolName(toolCall) {
  return toolCall?.name || toolCall?.toolName || toolCall?.tool?.name || 'tool';
}

function looksLikeShellBlock(body) {
  const commands = body
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (commands.length === 0 || commands.length > 8) return false;
  return commands.every(line =>
    /^[.$>#]/.test(line) ||
    /^(npm|pnpm|yarn|node|git|bash|sh|curl|openclaw|systemctl|python|pytest|jest|vitest|cargo|go|make)\b/i.test(line)
  );
}

function looksLikeVerificationCommand(command) {
  return /\b(test|check|verify|lint|assert|smoke|validate|ci)\b/i.test(command);
}

function looksLikeActionOrVerification(line) {
  return (
    /^(add|adjust|apply|build|check|compare|confirm|configure|create|deploy|edit|ensure|fix|generate|inspect|install|prepare|read|restart|review|run|ship|test|update|validate|verify|write)\b/i.test(line) ||
    /^(检查|确认|配置|创建|修复|更新|比较|运行|验证|测试|读取|写入|安装|重启|部署)/.test(line)
  );
}

function isVerificationStep(step) {
  return /\b(check|confirm|ensure|test|validate|verify|assert|smoke)\b/i.test(step) || /^(检查|确认|验证|测试)/.test(step);
}

function cleanStructuredLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return '';
  if (/^```/.test(trimmed) || /^<!--/.test(trimmed) || /^#+\s*/.test(trimmed)) return '';
  const bullet = trimmed.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '');
  if (!bullet || /^(done|completed|brief description|no reusable workflow here)\b/i.test(bullet)) return '';
  return collapseWhitespace(bullet);
}

function sanitizeFinding(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed.length >= 120) return null;
  if (SECRET_PATTERNS.some(pattern => pattern.test(trimmed))) {
    return '[REDACTED: sensitive finding]';
  }
  if (PROMPT_INJECTION_PATTERNS.some(pattern => pattern.test(trimmed))) {
    return null;
  }
  return trimmed;
}

function getTextBlocks(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text);
}

async function appendDoneRecord(doneFile, record) {
  let records = [];
  if (fs.existsSync(doneFile)) {
    try {
      records = JSON.parse(fs.readFileSync(doneFile, 'utf-8'));
      if (!Array.isArray(records)) records = [];
    } catch {
      records = [];
    }
  }

  records.push(record);
  await fs.promises.writeFile(doneFile, JSON.stringify(records, null, 2) + '\n', 'utf-8');
}

function dedupeStrings(values) {
  const result = [];
  const seen = new Set();

  for (const value of values) {
    const normalized = collapseWhitespace(String(value || ''));
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function collapseWhitespace(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureSentence(value) {
  const text = collapseWhitespace(value);
  if (!text) return '';
  return /[.!?`)]$/.test(text) ? text : `${text}.`;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function cleanupPendingState(id, workerSessionFile, originalSessionFile) {
  removePendingRecord(id);
  cleanupWorkerSessionFile(workerSessionFile, originalSessionFile);
}

function removePendingRecord(id) {
  if (!id) return;

  const pendingFile = path.join(__dirname, '..', '.pending-deep-reviews.json');
  try {
    if (!fs.existsSync(pendingFile)) return;
    const parsed = JSON.parse(fs.readFileSync(pendingFile, 'utf-8'));
    const next = Array.isArray(parsed) ? parsed.filter(record => record?.id !== id) : [];
    fs.writeFileSync(pendingFile, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  } catch (err) {
    log(`WARN: failed to prune pending deep review ${id}: ${err.message}`);
  }
}

function cleanupWorkerSessionFile(workerSessionFile, originalSessionFile) {
  if (!workerSessionFile) return;
  const spoolRoot = path.join(__dirname, '..', '.deep-review-spool') + path.sep;
  const resolvedWorkerFile = path.resolve(workerSessionFile);
  if (resolvedWorkerFile === path.resolve(originalSessionFile || '')) return;
  if (!resolvedWorkerFile.startsWith(spoolRoot)) return;
  try {
    fs.rmSync(resolvedWorkerFile, { force: true });
  } catch (err) {
    log(`WARN: failed to remove worker session file ${workerSessionFile}: ${err.message}`);
  }
}

// ============================================================================
// 启动
// ============================================================================

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = {
  buildSkillMarkdown,
  extractSessionData,
  generateSkillName,
  getSkipReason,
  normalizeTopic,
  parseCliArgs
};
