/**
 * compaction-provider.js
 *
 * Skills Evolution 的 context compaction provider。
 *
 * 两阶段压缩：
 * 1. 工具输出剪枝：先把大体积 tool 输出缩成一行摘要，避免把无价值日志送进 LLM。
 * 2. 中间轮次摘要：保留 head / tail 关键上下文，仅对中间区间调用子进程做 LLM 总结。
 *
 * 实现原则：
 * - 不引入第三方依赖。
 * - 对 message 结构做宽松兼容，尽量从未知 schema 中提取文本。
 * - 在 signal abort 时及时终止子进程。
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONFIG_FILE = path.join(__dirname, '..', 'compaction-config.json');
const SCRIPT_FILE = path.join(__dirname, '..', 'scripts', 'compaction-summarizer.js');

const DEFAULT_CONFIG = {
  enabled: true,
  thresholdPercent: 0.5,
  protectFirstN: 3,
  protectLastN: 20,
  summaryTargetRatio: 0.2,
  model: 'MiniMax-M2.7',
  provider: 'minimax-cn',
  baseUrl: 'https://api.minimaxi.com/v1',
  apiKeyEnv: 'MINIMAX_API_KEY',
  timeout: 120,
  maxSummaryTokens: 4000
};

/**
 * Provider 主入口。
 */
async function summarize({ messages, previousSummary, customInstructions, signal }) {
  const config = await loadConfig();
  const safeMessages = Array.isArray(messages) ? messages : [];
  const prunedMessages = safeMessages.map(pruneLargeToolMessage);

  if (!config.enabled) {
    return buildFallbackSummary({
      previousSummary,
      messages: prunedMessages,
      customInstructions,
      reason: 'Compaction is disabled in config.'
    });
  }

  const headCount = Math.max(0, Number(config.protectFirstN || 0));
  const tailCount = Math.max(0, Number(config.protectLastN || 0));
  const slices = splitMessages(prunedMessages, headCount, tailCount);
  const serializedHead = serializeMessages(slices.head);
  const serializedTail = serializeMessages(slices.tail);
  const totalTokens = prunedMessages.reduce((sum, message) => sum + estimateTokens(extractMessageText(message)), 0);
  const middleTokens = slices.middle.reduce((sum, message) => sum + estimateTokens(extractMessageText(message)), 0);
  const middleRatio = totalTokens === 0 ? 0 : middleTokens / totalTokens;

  let middleSummary = 'No middle context to summarize.';
  if (slices.middle.length > 0) {
    if (middleRatio < Number(config.thresholdPercent || 0)) {
      middleSummary = buildCondensedMiddleFallback(
        slices.middle,
        `middle ratio ${middleRatio.toFixed(2)} below threshold ${Number(config.thresholdPercent || 0).toFixed(2)}`
      );
    } else {
      try {
        middleSummary = await runSummarizerChild({
          messages: slices.middle,
          previousSummary,
          customInstructions,
          signal,
          config
        });
      } catch (error) {
        middleSummary = buildCondensedMiddleFallback(slices.middle, error.message);
      }
    }
  }

  const result = [
    '[skills-evolution compaction]',
    '',
    '## Previous Summary',
    sanitizeSummarySection(previousSummary || 'No previous summary.'),
    '',
    '## Preserved Head',
    serializedHead || 'No preserved head context.',
    '',
    '## Summarized Middle',
    sanitizeSummarySection(middleSummary),
    '',
    '## Preserved Tail',
    serializedTail || 'No preserved tail context.',
    '',
    '## Active Task Hint',
    'Respond only to the most recent user request after this compacted summary.'
  ].join('\n');

  return trimToTokenBudget(result, config.maxSummaryTokens);
}

/**
 * 从配置文件读取 compaction 配置；缺失项自动回退到默认值。
 */
async function loadConfig() {
  try {
    const raw = await fs.promises.readFile(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...(parsed || {}) };
  } catch (error) {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * 剪枝体积较大的 tool 输出。
 * 小于 200 字符的内容保持原样，尽量不破坏原始上下文。
 */
function pruneLargeToolMessage(message) {
  if (!message || message.role !== 'tool') {
    return message;
  }

  const text = extractMessageText(message);
  if (text.length < 200) {
    return message;
  }

  const toolName = extractToolName(message);
  const summary = summarizeToolMessage(toolName, message, text);
  return {
    ...message,
    content: [{ type: 'text', text: summary }]
  };
}

function summarizeToolMessage(toolName, message, text) {
  const normalizedTool = String(toolName || '').toLowerCase();
  const lineCount = text.split(/\r?\n/).filter(Boolean).length || 1;

  if (normalizedTool.includes('terminal') || normalizedTool.includes('exec')) {
    const command = detectCommand(message, text);
    const exitCode = detectExitCode(message, text);
    return `[terminal] ran \`${command}\` -> exit ${exitCode}, ${lineCount} lines`;
  }

  if (normalizedTool.includes('read_file') || normalizedTool.includes('readfile')) {
    const filePath = detectPath(message, text);
    return `[read_file] read ${filePath} (${text.length} chars)`;
  }

  return `[${toolName || 'tool'}] output trimmed (${text.length} chars, ${lineCount} lines)`;
}

/**
 * 把 messages 切成 head / middle / tail 三段。
 */
function splitMessages(messages, protectFirstN, protectLastN) {
  if (messages.length <= protectFirstN + protectLastN) {
    return {
      head: messages,
      middle: [],
      tail: []
    };
  }

  const head = messages.slice(0, protectFirstN);
  const tail = protectLastN > 0 ? messages.slice(-protectLastN) : [];
  const middle = messages.slice(protectFirstN, messages.length - tail.length);

  return { head, middle, tail };
}

/**
 * 子进程调用独立脚本做 LLM 摘要，避免主插件线程阻塞在网络调用上。
 */
async function runSummarizerChild({ messages, previousSummary, customInstructions, signal, config }) {
  const args = [
    SCRIPT_FILE,
    '--messages', JSON.stringify(messages),
    '--previous-summary', String(previousSummary || ''),
    '--custom-instructions', String(customInstructions || '')
  ];

  const child = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SKILLS_EVOLUTION_COMPACTION_CONFIG: JSON.stringify(config)
    }
  });

  let stdout = '';
  let stderr = '';
  let settled = false;

  const abortHandler = () => {
    if (!settled) {
      child.kill('SIGTERM');
    }
  };

  if (signal && typeof signal.addEventListener === 'function') {
    if (signal.aborted) {
      abortHandler();
    } else {
      signal.addEventListener('abort', abortHandler, { once: true });
    }
  }

  child.stdout.on('data', chunk => {
    stdout += chunk.toString('utf-8');
  });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf-8');
  });

  return new Promise((resolve, reject) => {
    child.on('error', error => {
      settled = true;
      cleanupAbortListener(signal, abortHandler);
      reject(error);
    });

    child.on('close', code => {
      settled = true;
      cleanupAbortListener(signal, abortHandler);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `summarizer exited with code ${code}`));
        return;
      }
      resolve(stdout.trim() || 'No summary generated.');
    });
  });
}

function cleanupAbortListener(signal, abortHandler) {
  if (signal && typeof signal.removeEventListener === 'function') {
    signal.removeEventListener('abort', abortHandler);
  }
}

/**
 * 以文本形式序列化 message，供 summary 保留 head / tail 使用。
 */
function serializeMessages(messages) {
  return messages
    .map((message, index) => serializeMessage(message, index))
    .filter(Boolean)
    .join('\n\n');
}

function serializeMessage(message, index) {
  const role = String(message?.role || 'unknown');
  const text = extractMessageText(message) || extractStructuredPreview(message);
  const normalized = normalizeWhitespace(text).slice(0, 1200);
  if (!normalized) {
    return `[${index + 1}] ${role}: [no textual content]`;
  }
  return `[${index + 1}] ${role}: ${normalized}`;
}

function buildFallbackSummary({ previousSummary, messages, customInstructions, reason }) {
  const headTail = splitMessages(messages, 3, 10);
  return [
    '[skills-evolution compaction fallback]',
    '',
    `Reason: ${reason}`,
    '',
    '## Previous Summary',
    sanitizeSummarySection(previousSummary || 'No previous summary.'),
    '',
    '## Context',
    serializeMessages(headTail.head),
    headTail.middle.length > 0 ? `\n[middle omitted: ${headTail.middle.length} messages]\n` : '',
    serializeMessages(headTail.tail),
    '',
    '## Custom Instructions',
    sanitizeSummarySection(customInstructions || 'None.')
  ].join('\n');
}

function buildCondensedMiddleFallback(messages, errorMessage) {
  const estimate = messages.reduce((sum, message) => sum + estimateTokens(extractMessageText(message)), 0);
  return [
    `Middle context fallback summary (${messages.length} messages, ~${estimate} tokens).`,
    `Reason: ${errorMessage}`,
    '',
    serializeMessages(messages.slice(-8))
  ].join('\n');
}

function sanitizeSummarySection(text) {
  return normalizeWhitespace(String(text || '')).slice(0, 8000) || 'None.';
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractMessageText(message) {
  if (!message) return '';
  if (typeof message.content === 'string') {
    return message.content;
  }

  if (!Array.isArray(message.content)) {
    return '';
  }

  return message.content
    .map(block => {
      if (!block || typeof block !== 'object') return '';
      if (typeof block.text === 'string') return block.text;
      if (typeof block.content === 'string') return block.content;
      if (typeof block.input === 'string') return block.input;
      if (typeof block.output === 'string') return block.output;
      if (typeof block.args === 'string') return block.args;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractStructuredPreview(message) {
  try {
    return JSON.stringify(message).slice(0, 1200);
  } catch (error) {
    return '';
  }
}

function extractToolName(message) {
  return message?.name || message?.toolName || message?.tool?.name || 'tool';
}

function detectCommand(message, text) {
  const command = message?.command || message?.cmd || message?.input;
  if (typeof command === 'string' && command.trim()) {
    return command.trim().slice(0, 160);
  }

  const quotedMatch = text.match(/"cmd"\s*:\s*"([^"]+)"/);
  if (quotedMatch) return quotedMatch[1].slice(0, 160);

  const shellMatch = text.match(/\b(?:\$|>)\s*(.+)/);
  if (shellMatch) return shellMatch[1].trim().slice(0, 160);

  return 'unknown-command';
}

function detectExitCode(message, text) {
  const direct = message?.exitCode ?? message?.code ?? message?.status;
  if (Number.isFinite(Number(direct))) {
    return Number(direct);
  }

  const match = text.match(/\bexit(?:\s+code)?\D+(-?\d+)\b/i);
  if (match) {
    return Number(match[1]);
  }
  return 0;
}

function detectPath(message, text) {
  const direct = message?.path || message?.filePath || message?.file;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim().slice(0, 200);
  }

  const quotedMatch = text.match(/"(?:path|filePath|file)"\s*:\s*"([^"]+)"/);
  if (quotedMatch) return quotedMatch[1].slice(0, 200);

  const plainMatch = text.match(/(?:path|file):\s*([^\n]+)/i);
  if (plainMatch) return plainMatch[1].trim().slice(0, 200);

  return 'unknown-path';
}

/**
 * 粗略 token 估算：中文按 2 字符 = 1 token，英文按 4 字符 = 1 token。
 */
function estimateTokens(text) {
  let count = 0;
  for (const char of String(text || '')) {
    count += char.charCodeAt(0) > 127 ? 2 : 1;
  }
  return Math.ceil(count / 4);
}

function trimToTokenBudget(text, maxTokens) {
  const budget = Math.max(256, Number(maxTokens || DEFAULT_CONFIG.maxSummaryTokens));
  if (estimateTokens(text) <= budget) {
    return text;
  }

  const maxChars = budget * 4;
  return `${String(text).slice(0, Math.max(0, maxChars - 32)).trim()}\n\n[truncated to fit token budget]`;
}

module.exports = {
  summarize,
  estimateTokens,
  loadConfig,
  pruneLargeToolMessage
};
