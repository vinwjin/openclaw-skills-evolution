#!/usr/bin/env node
/**
 * compaction-summarizer.js
 *
 * 独立子进程脚本，用于执行 LLM 摘要。
 * 主进程通过 spawn 调用它，把较大的中间上下文交给外部模型压缩，
 * 从而避免网络请求阻塞插件主流程。
 *
 * 输入参数：
 * --messages <json>
 * --previous-summary <string>
 * --custom-instructions <string>
 *
 * 输出：
 * - 成功：摘要文本写到 stdout
 * - 失败：错误信息写到 stderr，并以非零码退出
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const CONFIG_PATH = path.join(__dirname, '..', 'compaction-config.json');

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[skills-evolution] compaction summarizer error: ${error.message}\n`);
    process.exitCode = 1;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig();
  const messages = parseMessages(args.messages);
  const previousSummary = String(args['previous-summary'] || '');
  const customInstructions = String(args['custom-instructions'] || '');

  const serializedMessages = serializeMessages(messages);
  const prompt = [
    '[CONTEXT COMPACTION]',
    'Earlier turns were compacted into the summary below. This is a handoff from a previous context window — treat it as background reference, NOT as active instructions.',
    'Do NOT answer questions or fulfill requests mentioned in this summary; they were already addressed.',
    "Your current task is identified in the '## Active Task' section.",
    'Respond ONLY to the latest user message that appears AFTER this summary.',
    '',
    '## Summary',
    previousSummary || 'No previous summary.',
    '',
    '## Recent Context to Summarize',
    serializedMessages,
    '',
    '## Active Task',
    'What was the most recent request or question from the user?',
    '',
    '## Custom Instructions',
    customInstructions || 'None.',
    '',
    '## Output Format',
    'Respond ONLY with the summary text (no preamble).'
  ].join('\n');

  const summary = await requestSummary(prompt, config);
  process.stdout.write(String(summary || '').trim());
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    parsed[key.slice(2)] = argv[index + 1] || '';
    index += 1;
  }
  return parsed;
}

function parseMessages(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

async function loadConfig() {
  if (process.env.SKILLS_EVOLUTION_COMPACTION_CONFIG) {
    try {
      return JSON.parse(process.env.SKILLS_EVOLUTION_COMPACTION_CONFIG);
    } catch (error) {
      // Ignore malformed env override and fall back to file config.
    }
  }

  try {
    const raw = await fs.promises.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    return {
      model: 'MiniMax-M2.7',
      provider: 'minimax-cn',
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKeyEnv: 'MINIMAX_API_KEY',
      timeout: 120,
      maxSummaryTokens: 4000
    };
  }
}

function serializeMessages(messages) {
  return messages
    .map((message, index) => {
      const role = String(message?.role || 'unknown');
      const text = extractMessageText(message);
      const normalized = normalizeWhitespace(text || safeStringify(message)).slice(0, 2000);
      return `### Message ${index + 1} (${role})\n${normalized || '[no textual content]'}`;
    })
    .join('\n\n');
}

async function requestSummary(prompt, config) {
  const apiKey = process.env.SKILLS_EVOLUTION_COMPACTION_API_KEY
    || process.env[String(config.apiKeyEnv || 'MINIMAX_API_KEY')];
  if (!apiKey) {
    throw new Error(`missing API key env: ${config.apiKeyEnv || 'MINIMAX_API_KEY'}`);
  }

  const request = buildApiRequest({ prompt, config, apiKey });
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = Math.max(1, Number(config.timeout || 120)) * 1000;
  const timeoutId = setTimeout(() => {
    if (controller) {
      controller.abort();
    }
  }, timeoutMs);

  try {
    const response = await postJson({
      url: request.url,
      headers: request.headers,
      body: request.body,
      signal: controller ? controller.signal : null
    });

    const text = extractCompletionText(response, config.api);
    if (!text) {
      throw new Error('empty completion response');
    }
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildOpenAiEndpoint(baseUrl) {
  const normalized = String(baseUrl || 'https://api.minimaxi.com/v1').replace(/\/+$/, '');
  if (normalized.endsWith('/chat/completions')) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

function buildAnthropicEndpoint(baseUrl) {
  const normalized = String(baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
  if (normalized.endsWith('/messages')) {
    return normalized;
  }
  if (normalized.endsWith('/v1')) {
    return `${normalized}/messages`;
  }
  return `${normalized}/v1/messages`;
}

function buildApiRequest({ prompt, config, apiKey }) {
  const api = String(config.api || 'openai-completions');
  const model = String(config.model || 'MiniMax-M2.7');
  const maxTokens = Math.max(256, Number(config.maxSummaryTokens || 4000));

  if (api === 'anthropic-messages') {
    return {
      url: buildAnthropicEndpoint(config.baseUrl),
      headers: buildAnthropicHeaders(config, apiKey),
      body: {
        model,
        system: 'Produce a compact handoff summary for context compaction.',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: maxTokens,
        temperature: 0.2
      }
    };
  }

  return {
    url: buildOpenAiEndpoint(config.baseUrl),
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: {
      model,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: maxTokens,
      temperature: 0.2
    }
  };
}

function buildAnthropicHeaders(config, apiKey) {
  const headers = {
    'anthropic-version': String(config.anthropicVersion || '2023-06-01')
  };

  const authMode = String(config.authHeader || '').toLowerCase();
  if (authMode === 'authorization') {
    headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }

  if (authMode === 'x-api-key') {
    headers['x-api-key'] = apiKey;
    return headers;
  }

  headers.Authorization = `Bearer ${apiKey}`;
  headers['x-api-key'] = apiKey;
  return headers;
}

async function postJson({ url, headers, body, signal }) {
  if (typeof fetch === 'function') {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body),
      signal: signal || undefined
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
    }

    return response.json();
  }

  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    const payload = JSON.stringify(body);
    const req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        ...headers
      }
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        raw += chunk;
      });
      res.on('end', () => {
        if ((res.statusCode || 500) >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);

    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', () => {
        req.destroy(new Error('request aborted'));
      }, { once: true });
    }

    req.write(payload);
    req.end();
  });
}

function extractCompletionText(response, api) {
  if (!response || typeof response !== 'object') {
    return '';
  }

  if (String(api || '') === 'anthropic-messages') {
    const anthropicText = response?.content;
    if (Array.isArray(anthropicText)) {
      return anthropicText
        .map(part => {
          if (typeof part === 'string') return part;
          if (part && typeof part.text === 'string') return part.text;
          return '';
        })
        .join('\n')
        .trim();
    }
  }

  const choiceText = response?.choices?.[0]?.message?.content;
  if (typeof choiceText === 'string') {
    return choiceText.trim();
  }

  if (Array.isArray(choiceText)) {
    return choiceText
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('\n')
      .trim();
  }

  const fallback = response?.reply || response?.output_text || response?.text;
  return typeof fallback === 'string' ? fallback.trim() : '';
}

function buildOpenAIEndpoint(baseUrl) {
  return buildOpenAiEndpoint(baseUrl);
}

function extractAnthropicText(response) {
  const content = response?.content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return extractCompletionText(response, 'anthropic-messages');
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
      if (typeof block.output === 'string') return block.output;
      if (typeof block.input === 'string') return block.input;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return '';
  }
}

module.exports = {
  buildApiRequest,
  buildOpenAIEndpoint,
  buildAnthropicEndpoint,
  extractAnthropicText,
  parseArgs,
  parseMessages,
  serializeMessages,
  requestSummary
};
