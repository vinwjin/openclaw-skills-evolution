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

// ============================================================================
// CLI 参数解析
// ============================================================================

const args = process.argv.slice(2);
let sessionFile = null;
let workspace = null;
let skillName = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--session-file' && i + 1 < args.length) {
    sessionFile = args[++i];
  } else if (args[i] === '--workspace' && i + 1 < args.length) {
    workspace = args[++i];
  } else if (args[i] === '--skill-name' && i + 1 < args.length) {
    skillName = args[++i];
  }
}

if (!sessionFile || !workspace) {
  console.error('Usage: node deep-review-worker.js --session-file <path> --workspace <path> [--skill-name <name>]');
  process.exit(1);
}

workspace = path.resolve(workspace);

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

  log(`Starting deep-review-worker: sessionFile=${sessionFile}, workspace=${workspace}, skillName=${skillName || 'auto'}`);

  try {
    // 1. 读取 session JSONL
    if (!fs.existsSync(sessionFile)) {
      throw new Error(`session file not found: ${sessionFile}`);
    }

    const raw = await fs.promises.readFile(sessionFile, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim());
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
    log(`Session topic: ${sessionData.topic}, tools: ${sessionData.tools.join(', ')}`);

    // 3. 生成 skill 名称（如果未指定）
    const finalSkillName = skillName || generateSkillName(sessionData.topic);
    const safeName = toSafeName(finalSkillName);

    // 4. 生成 SKILL.md 内容
    const skillContent = buildSkillMarkdown(sessionData, finalSkillName);

    // 5. 写入 skills 目录
    const skillDir = path.join(workspace, 'skills', safeName);
    const filePath = path.join(skillDir, 'SKILL.md');

    await fs.promises.mkdir(skillDir, { recursive: true });
    await fs.promises.writeFile(filePath, skillContent, 'utf-8');

    log(`Skill written to: ${filePath}`);

    // 6. 记录完成状态到 .deep-review-done.json
    const doneRecord = {
      skillName: finalSkillName,
      safeName,
      sessionFile,
      topic: sessionData.topic,
      completedAt: new Date().toISOString(),
      filePath
    };

    // 读取已有记录
    let records = [];
    if (fs.existsSync(pendingDoneFile)) {
      try {
        records = JSON.parse(fs.readFileSync(pendingDoneFile, 'utf-8'));
        if (!Array.isArray(records)) records = [];
      } catch { records = []; }
    }

    records.push(doneRecord);
    await fs.promises.writeFile(pendingDoneFile, JSON.stringify(records, null, 2) + '\n', 'utf-8');

    log(`Recorded to .deep-review-done.json`);
    log('Deep review completed successfully.');

  } catch (err) {
    log(`ERROR: ${err.message}`);
    // 记录失败状态
    const failRecord = {
      sessionFile,
      skillName: skillName || null,
      error: err.message,
      completedAt: new Date().toISOString()
    };

    let records = [];
    const pendingDoneFile = path.join(__dirname, '..', '.deep-review-done.json');
    if (fs.existsSync(pendingDoneFile)) {
      try {
        records = JSON.parse(fs.readFileSync(pendingDoneFile, 'utf-8'));
        if (!Array.isArray(records)) records = [];
      } catch { records = []; }
    }

    records.push({ ...failRecord, status: 'failed' });
    await fs.promises.writeFile(pendingDoneFile, JSON.stringify(records, null, 2) + '\n', 'utf-8');

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
  let topic = 'Unknown';
  if (userMsgs.length > 0) {
    const first = userMsgs[0];
    const textBlocks = Array.isArray(first.content)
      ? first.content.filter(b => b.type === 'text' && typeof b.text === 'string')
      : [];
    topic = textBlocks.map(b => b.text).join('\n').slice(0, 80).replace(/\n/g, ' ').trim() || 'Unknown';
  }

  // 提取关键发现（代码片段）
  const findings = [];
  for (const msg of assistantMsgs) {
    const textBlocks = Array.isArray(msg.content)
      ? msg.content.filter(b => b.type === 'text' && typeof b.text === 'string')
      : [];
    const text = textBlocks.map(b => b.text).join('\n');

    const codeBlocks = text.match(/```[\s\S]*?```/g) || [];
    for (const block of codeBlocks.slice(0, 3)) {
      const firstLine = block.split('\n')[1] || '';
      if (firstLine.length > 0 && firstLine.length < 120) {
        findings.push(firstLine.trim());
      }
    }
  }

  return {
    topic,
    tools: Array.from(toolNames),
    findings: findings.slice(0, 5)
  };
}

function generateSkillName(topic) {
  // 从 topic 生成一个描述性名称
  const words = topic
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

function toSafeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildSkillMarkdown(data, name) {
  const { topic, tools, findings } = data;

  const toolList = tools.length > 0 ? `\n- **Tools used**: ${tools.join(', ')}` : '';

  const findingsBlock = findings.length > 0
    ? '\n## Key Findings\n\n' + findings.map(f => `- ${f}`).join('\n')
    : '';

  return `---
name: ${JSON.stringify(name)}
description: ${JSON.stringify(`Skill extracted from session: ${topic}`)}
triggers:
  - ${JSON.stringify(topic)}
actions:
  - summary
---

# ${name}

## Context

This skill captures work from a session about: **${topic}**${toolList}

## Overview

Brief description of the approach used in this session.

## Steps

${findingsBlock ? findingsBlock + '\n' : ''}
<!-- Add detailed steps based on session content -->

## Notes

<!-- Add any important notes or caveats -->
`;
}

// ============================================================================
// 启动
// ============================================================================

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});