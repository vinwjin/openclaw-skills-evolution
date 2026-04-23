/**
 * OpenClaw Skills Evolution Plugin
 * v0.5: 子 Agent 后台固化 + 主动审视指令 + 任务中主动发现
 *
 * 升级内容：
 * 1. session_end 时 spawn 子 Agent 在后台完成 skill 固化，主 Agent 不阻塞
 * 2. 新增 trigger_review / trigger_deep_review 工具，用户可主动触发审视
 * 3. before_prompt_build 增加复杂度检测，超过 10 次工具调用则主动注入发现提示
 */

const fs = require('fs');
const path = require('path');
const { SkillLoader } = require('./lib/skill-loader');
const { SkillSaver } = require('./lib/skill-saver');
const { SkillIndex } = require('./lib/skill-index');
const { SessionSummarizer } = require('./lib/session-summarizer');
const { spawnDeepReview } = require('./lib/skill-summarizer-agent');

// ============================================================================
// 全局待审视 session 队列
// ============================================================================
const pendingReviews = [];
const pendingReviewsFile = path.join(__dirname, '.pending-reviews.json');
let pendingReviewsMtime = 0;
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+previous\s+instructions/i,
  /call\s+skill_manage/i,
  /system\s+prompt/i
];

// ============================================================================
// Plugin Definition
// ============================================================================

const plugin = {
  id: 'skills-evolution',
  name: 'Skills Evolution',
  description: 'Skills 自我进化系统 — 双轨沉淀经验为可复用 SKILL.md',

  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {}
  },

  register(api) {
    // -------------------------------------------------------------------------
    // Context compaction: anti-thrashing hooks + provider registration
    // -------------------------------------------------------------------------
    api.on('before_compaction', async (event, ctx) => {
      const throttle = require('./lib/compaction-throttle');
      const shouldContinue = await throttle.check({
        tokenCount: event?.tokenCount,
        sessionKey: ctx?.sessionKey
      });

      if (!shouldContinue) {
        console.error('[skills-evolution] compaction skipped: anti-thrashing cooldown');
        return;
      }
    });

    api.on('after_compaction', async (event, ctx) => {
      const throttle = require('./lib/compaction-throttle');
      await throttle.record({
        estimatedOriginalTokens: Number(event?.tokenCount || 0) + (Number(event?.compactedCount || 0) * 200),
        compressedTokens: Number(event?.tokenCount || 0),
        sessionKey: ctx?.sessionKey
      });
    });

    if (typeof api.registerCompactionProvider === 'function') {
      api.registerCompactionProvider({
        id: 'skills-evolution-compactor',
        label: 'Skills Evolution Compactor',
        summarize: async ({ messages, previousSummary, customInstructions, signal }) => {
          const provider = require('./lib/compaction-provider');
          return provider.summarize({ messages, previousSummary, customInstructions, signal });
        }
      });
    }

    // -------------------------------------------------------------------------
    // 轨道2-A：session_end — spawn 子 Agent 固化（不阻塞）
    // -------------------------------------------------------------------------
    api.on('session_end', async (event, ctx) => {
      const sessionId = ctx?.sessionId || event.sessionId || event.session?.id;
      const sessionFile = event.sessionFile;

      if (!sessionFile || !sessionId) return;

      try {
        await loadPendingReviews();

        // 读取并摘要 session（同步，毫秒级）
        const summarizer = new SessionSummarizer();
        const summary = await summarizer.summarize(sessionFile);
        if (!summary) return;

        // 存入待审视队列
        pendingReviews.push({
          ...summary,
          timestamp: Date.now()
        });
        await savePendingReviews();

        // 立即 spawn 子 Agent 做深度固化（不阻塞）
        const workspace = getWorkspace();
        spawnDeepReview(sessionFile, workspace, null);

        console.error(`[skills-evolution] session_end: queued + spawned deep-review — topic="${summary?.topic || 'none'}"`);
      } catch (err) {
        console.error(`[skills-evolution] session_end error: ${sessionId} — ${err.message}`);
      }
    });

    // -------------------------------------------------------------------------
    // 轨道2-B：before_prompt_build — 注入审视机会 + 复杂度检测
    // -------------------------------------------------------------------------
    api.on('before_prompt_build', async (event, ctx) => {
      await loadPendingReviews();

      const parts = [];

      // 1. 复杂度检测：当前 session 工具调用超过阈值时主动注入发现提示
      const toolCallCount = countToolCalls(event);
      const COMPLEXITY_THRESHOLD = 10;
      if (toolCallCount > COMPLEXITY_THRESHOLD) {
        const complexityPrompt = buildComplexityPrompt({
          topic: extractTopicFromEvent(event),
          toolCallCount,
          tools: extractToolsFromEvent(event)
        });
        parts.push(complexityPrompt);
        console.error(`[skills-evolution] before_prompt_build: complexity detected — ${toolCallCount} tool calls`);
      }

      // 2. 如果有待审视的 session，注入审视提示
      if (pendingReviews.length > 0) {
        const entry = pendingReviews.shift();
        if (entry) {
          await savePendingReviews();
          parts.push(buildReviewPrompt(entry));
          console.error(`[skills-evolution] before_prompt_build: injected review — topic="${entry.topic}", remaining=${pendingReviews.length}`);
        }
      }

      if (parts.length === 0) return;

      return { appendSystemContext: parts.join('\n') };
    });

    // -------------------------------------------------------------------------
    // 轨道1：skill_manage 工具（保持不变）
    // -------------------------------------------------------------------------
    api.registerTool({
      name: 'skill_manage',
      description:
        '管理 Skills — 创建新 Skill 或更新已有 Skill。' +
        'Skills 是可重用的工作流文档，存储在 ~/.openclaw/workspace/skills/。' +
        '当发现复杂问题的解决方案、反复出现的任务模式、或被纠正的错误时，创建 Skill。' +
        "action='create' 时，content 只需提供 Markdown 正文；可选的 description、triggers、actions 会自动写入 YAML frontmatter。",
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'edit', 'patch', 'delete'],
            description: "操作类型：'create'(新建), 'edit'(全量重写), 'patch'(局部替换), 'delete'(删除)"
          },
          name: {
            type: 'string',
            description: 'Skill 名称（用于标识和检索）'
          },
          content: {
            type: 'string',
            description: "Skill 内容。用于 action='create' 时传入 Markdown 正文；用于 action='edit' 时传入完整 SKILL.md（含 YAML frontmatter）。"
          },
          description: {
            type: 'string',
            description: "Skill 描述。可选；用于 action='create' 时写入 frontmatter。"
          },
          triggers: {
            type: 'array',
            items: { type: 'string' },
            description: "Skill 触发条件列表。可选；用于 action='create' 时写入 frontmatter。"
          },
          actions: {
            type: 'array',
            items: { type: 'string' },
            description: "Skill 动作列表。可选；用于 action='create' 时写入 frontmatter。"
          },
          old_string: {
            type: 'string',
            description: "要替换的文本。用于 action='patch'。必须完全匹配（包括空白）。"
          },
          new_string: {
            type: 'string',
            description: "替换文本。用于 action='patch'。空字符串表示删除。"
          }
        },
        required: ['action', 'name']
      },

      async execute(toolCallId, params) {
        const { action, name, content, description, triggers, actions, old_string, new_string } = params;

        if (action === 'create') return handleCreate(name, content, { description, triggers, actions });
        if (action === 'edit') return handleEdit(name, content);
        if (action === 'patch') return handlePatch(name, old_string, new_string);
        if (action === 'delete') return handleDelete(name);

        return formatError(`Unknown action '${action}'. Use create, edit, patch, or delete.`);
      }
    });

    api.registerTool({
      name: 'skill_list',
      description: '列出所有可用的 Skills，显示名称和描述。',
      parameters: { type: 'object', properties: {} },

      async execute(toolCallId, params) {
        const loader = new SkillLoader();
        const workspace = getWorkspace();
        const skills = await loader.loadAll(workspace);

        if (skills.length === 0) {
          return formatResult('No skills found in ~/.openclaw/workspace/skills/');
        }

        const lines = skills.map(s =>
          `- **${s.name}**: ${s.frontmatter.description || ''}`
        );
        return formatResult(`Available Skills (${skills.length}):\n\n${lines.join('\n')}`);
      }
    });

    api.registerTool({
      name: 'skill_search',
      description: '在 Skills 中搜索关键词，返回匹配的 Skills 列表。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' }
        },
        required: ['query']
      },

      async execute(toolCallId, params) {
        const { query } = params;

        const loader = new SkillLoader();
        const workspace = getWorkspace();
        await loader.loadAll(workspace);

        const index = new SkillIndex();
        for (const skill of loader.getLoaded()) {
          index.add(parseSkillContent(skill));
        }

        const results = index.search(query);
        if (results.length === 0) {
          return formatResult(`No skills matching "${query}"`);
        }

        const lines = results.map(r =>
          `- **${r.name}** (score: ${r.score}): ${r.description || ''}`
        );
        return formatResult(`Search results for "${query}":\n\n${lines.join('\n')}`);
      }
    });

    // -------------------------------------------------------------------------
    // v0.5 新增：主动审视工具
    // -------------------------------------------------------------------------
    api.registerTool({
      name: 'trigger_review',
      description: '对当前 session 进行摘要，生成审视机会并注入到下一个 prompt。立即返回，不阻塞。',
      parameters: { type: 'object', properties: {} },

      async execute(toolCallId, params, ctx) {
        const sessionFile = ctx?.sessionFile || null;

        if (!sessionFile) {
          return formatError('sessionFile not available for trigger_review');
        }

        try {
          const summarizer = new SessionSummarizer();
          const summary = await summarizer.summarize(sessionFile);
          if (!summary) {
            return formatError('Failed to summarize session');
          }

          // 注入审视机会到 pendingReviews（供 before_prompt_build 使用）
          pendingReviews.push({
            ...summary,
            timestamp: Date.now(),
            triggered: true
          });
          await savePendingReviews();

          const topic = summary.topic || 'unknown';
          const toolCount = summary.tools?.length || 0;
          const findingsCount = summary.keyFindings?.length || 0;

          return formatResult(
            `Review triggered for session: "${topic}".\n` +
            `Tools used: ${toolCount}, Key findings: ${findingsCount}.\n` +
            `审视提示已注入到下一个 prompt，当前 pending reviews: ${pendingReviews.length}`
          );
        } catch (err) {
          return formatError(`trigger_review failed: ${err.message}`);
        }
      }
    });

    api.registerTool({
      name: 'trigger_deep_review',
      description: 'Spawn 子 Agent 在后台做深度固化。立即返回，不阻塞。可通过查询 .deep-review-done.json 查看结果。',
      parameters: {
        type: 'object',
        properties: {
          skill_name: {
            type: 'string',
            description: '可选，指定要创建的 skill 名称'
          }
        }
      },

      async execute(toolCallId, params, ctx) {
        const sessionFile = ctx?.sessionFile || null;
        const workspace = getWorkspace();

        if (!sessionFile) {
          return formatError('sessionFile not available for trigger_deep_review');
        }

        try {
          const { skillName } = params;
          const { pendingId } = spawnDeepReview(sessionFile, workspace, skillName || null);

          return formatResult(
            `Deep review spawned (id: ${pendingId}).\n` +
            `后台固化进程已启动，结果将写入 ~/.openclaw/extensions/skills-evolution/.deep-review-done.json\n` +
            `可通过检查该文件查看完成状态。`
          );
        } catch (err) {
          return formatError(`trigger_deep_review failed: ${err.message}`);
        }
      }
    });
  }
};

// ============================================================================
// Helpers
// ============================================================================

// -------------------------------------------------------------------------
// 复杂度检测辅助函数（用于 before_prompt_build 主动发现）
// -------------------------------------------------------------------------

/**
 * 从 event 对象统计当前 session 的工具调用次数
 */
function countToolCalls(event) {
  const messages = event?.messages || [];
  let count = 0;
  for (const msg of messages) {
    if (msg?.role !== 'assistant') continue;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block?.type === 'toolCall') {
        count++;
        // nested tool calls
        if (block?.toolCalls) {
          count += block.toolCalls.length;
        }
      }
    }
  }
  return count;
}

/**
 * 从 event 对象提取主题（第一个用户消息前80字符）
 */
function extractTopicFromEvent(event) {
  const messages = event?.messages || [];
  for (const msg of messages) {
    if (msg?.role === 'user') {
      const content = Array.isArray(msg.content) ? msg.content : [];
      for (const block of content) {
        if (block?.type === 'text' && typeof block?.text === 'string') {
          return block.text.slice(0, 80).replace(/\n/g, ' ').trim() || 'Unknown';
        }
      }
    }
  }
  return 'Unknown';
}

/**
 * 从 event 对象提取用到的工具列表
 */
function extractToolsFromEvent(event) {
  const messages = event?.messages || [];
  const tools = new Set();
  for (const msg of messages) {
    if (msg?.role !== 'assistant') continue;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block?.type === 'toolCall') {
        const name = block?.name || block?.toolName || block?.tool?.name || '';
        if (name) tools.add(name);
        if (block?.toolCalls) {
          for (const nested of block.toolCalls) {
            const n = nested?.name || nested?.toolName || '';
            if (n) tools.add(n);
          }
        }
      }
    }
  }
  return Array.from(tools);
}

/**
 * 构建复杂度触发的主动发现提示
 */
function buildComplexityPrompt({ topic, toolCallCount, tools }) {
  const topicSummary = summarizePromptField(topic, 60, '复杂任务');
  const toolList = tools.length > 0 ? `工具数量: ${tools.length}（示例: ${tools.slice(0, 5).map(tool => escapePromptText(tool, 30)).join(', ')}${tools.length > 5 ? '...' : ''}）` : '工具数量: 0';
  return `
## 🎯 检测到值得沉淀的经验

你在完成一个复杂任务（主题摘要：${topicSummary}，${toolCallCount}次工具调用）。这类复杂问题的解决方案通常值得固化。

${toolList}

如果这个解决方案是通用的，可以调用 trigger_deep_review 启动后台固化流程。
`;
}

// -------------------------------------------------------------------------
// Session 摘要审视提示
// -------------------------------------------------------------------------

function buildReviewPrompt(entry) {
  const { topic, tools, keyFindings } = entry;
  const safeTopic = summarizePromptField(topic, 80, 'Unknown');
  const toolList = tools.length > 0
    ? `工具数量: ${tools.length}（${tools.slice(0, 8).map(tool => escapePromptText(tool, 30)).join(', ')}${tools.length > 8 ? '...' : ''}）`
    : '工具数量: 0';
  const findingsBlock = Array.isArray(keyFindings) && keyFindings.length > 0
    ? `\n关键发现 / 已完成内容（已转义）：\n${keyFindings.map(finding => `\n\`\`\`text\n${escapePromptText(finding, 200)}\n\`\`\``).join('')}\n`
    : '';

  return `
## 经验审视机会

上一个 session 主题摘要：**${safeTopic}**
${toolList}
${findingsBlock}

如果这个 session 中发现了值得复用的解决方案、反复出现的模式、或被纠正的错误，考虑调用 skill_manage create 沉淀为 SKILL.md。
`;
}

function buildSkillContent(name, body, opts = {}) {
  const lines = [`name: ${toYamlString(name)}`];
  const { description, triggers, actions } = opts;

  if (description && description.trim()) {
    lines.push(`description: ${toYamlString(description.trim())}`);
  }

  appendYamlList(lines, 'triggers', triggers);
  appendYamlList(lines, 'actions', actions);
  lines.unshift('---');  // 在最前面插入 '---'
  lines.push('---', ''); // 闭合 frontmatter

  const normalizedBody = body.endsWith('\n') ? body : `${body}\n`;
  return `${lines.join('\n')}${normalizedBody}`;
}

async function handleCreate(name, content, opts = {}) {
  if (!content) return formatError("content is required for action='create'");

  const saver = new SkillSaver();
  const workspace = getWorkspace();

  try {
    await saver.save(workspace, { name, content: buildSkillContent(name, content, opts) });
    return formatResult(`Skill '${name}' created successfully.`);
  } catch (e) {
    return formatError(`Failed to create skill: ${e.message}`);
  }
}

async function handleEdit(name, content) {
  if (!content) return formatError("content is required for action='edit'");

  const workspace = getWorkspace();
  const found = await findByName(name, workspace);
  if (!found) return formatError(`Skill '${name}' not found.`);

  try {
    const saver = new SkillSaver();
    saver.validate(content);
    // 写入前再次校验真实路径，阻止已存在 skill 被符号链接劫持。
    await assertWritableSkillTarget(workspace, found.path);
    await fs.promises.writeFile(found.path, content, 'utf-8');
    return formatResult(`Skill '${name}' updated.`);
  } catch (e) {
    return formatError(`Failed to update skill: ${e.message}`);
  }
}

async function handlePatch(name, old_string, new_string) {
  if (!old_string) return formatError("old_string is required for action='patch'");

  const workspace = getWorkspace();
  const found = await findByName(name, workspace);
  if (!found) return formatError(`Skill '${name}' not found.`);

  try {
    let content = await fs.promises.readFile(found.path, 'utf-8');
    if (!content.includes(old_string)) {
      return formatError('old_string not found in skill content. Check whitespace.');
    }
    content = content.replace(old_string, new_string || '');
    const saver = new SkillSaver();
    saver.validate(content);
    // patch 和 edit 共享相同的路径边界校验，避免越界覆盖任意文件。
    await assertWritableSkillTarget(workspace, found.path);
    await fs.promises.writeFile(found.path, content, 'utf-8');
    return formatResult(`Skill '${name}' patched.`);
  } catch (e) {
    return formatError(`Failed to patch skill: ${e.message}`);
  }
}

async function handleDelete(name) {
  const workspace = getWorkspace();
  const found = await findByName(name, workspace);
  if (!found) return formatError(`Skill '${name}' not found.`);

  try {
    await fs.promises.rm(found.skillDir, { recursive: true });
    return formatResult(`Skill '${name}' deleted.`);
  } catch (e) {
    return formatError(`Failed to delete skill: ${e.message}`);
  }
}

// ============================================================================

function getWorkspace() {
  return process.env.HOME + '/.openclaw/workspace';
}

async function findByName(name, workspace) {
  const loader = new SkillLoader();
  await loader.loadAll(workspace);
  const skillsRoot = path.join(workspace, 'skills');
  const resolvedSkillsRoot = await fs.promises.realpath(skillsRoot).catch(() => null);
  const normalizedSkillsRoot = resolvedSkillsRoot ? ensureTrailingSep(resolvedSkillsRoot) : null;

  for (const skill of loader.getLoaded()) {
    if (skill.name === name) {
      if (!normalizedSkillsRoot) return null;
      // 按名称查找时校验真实路径，防止 loader 之外的外部替换绕过边界限制。
      await rejectSymlink(skill.path);
      const resolvedSkillPath = await fs.promises.realpath(skill.path);
      if (!resolvedSkillPath.startsWith(normalizedSkillsRoot)) {
        throw new Error(`Skill path escapes workspace/skills: ${skill.path}`);
      }
      return { path: skill.path, skillDir: pathDir(skill.path) };
    }
  }
  return null;
}

function pathDir(p) {
  return p.replace(/[/\\][^/\\]+$/, '');
}

function appendYamlList(lines, key, values) {
  if (!Array.isArray(values) || values.length === 0) return;

  const items = values
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim());

  if (items.length === 0) return;

  lines.push(`${key}:`);
  for (const item of items) {
    lines.push(`  - ${toYamlString(item)}`);
  }
}

function toYamlString(value) {
  return JSON.stringify(String(value));
}

function parseSkillContent(skill) {
  const frontmatter = skill.frontmatter || {};
  const bodyContent = typeof skill.content === 'string'
    ? skill.content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim()
    : '';
  return {
    name: frontmatter.name || skill.name,
    description: frontmatter.description || '',
    triggers: Array.isArray(frontmatter.triggers) ? frontmatter.triggers : [],
    actions: Array.isArray(frontmatter.actions) ? frontmatter.actions : [],
    content: bodyContent
  };
}

async function loadPendingReviews() {
  try {
    if (!fs.existsSync(pendingReviewsFile)) return;

    const stat = await fs.promises.stat(pendingReviewsFile);
    // 文件未更新，跳过
    if (stat.mtimeMs <= pendingReviewsMtime) return;

    const raw = await fs.promises.readFile(pendingReviewsFile, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    pendingReviews.length = 0;
    pendingReviews.push(...parsed.filter(isValidPendingReview));
    pendingReviewsMtime = stat.mtimeMs;
  } catch (err) {
    console.error(`[skills-evolution] pending review load error: ${err.message}`);
  }
}

async function savePendingReviews() {
  try {
    await fs.promises.writeFile(
      pendingReviewsFile,
      JSON.stringify(pendingReviews, null, 2) + '\n',
      'utf-8'
    );
  } catch (err) {
    console.error(`[skills-evolution] pending review save error: ${err.message}`);
  }
}

function isValidPendingReview(entry) {
  return Boolean(
    entry &&
    typeof entry.topic === 'string' &&
    Array.isArray(entry.tools) &&
    Array.isArray(entry.keyFindings)
  );
}

function formatResult(message) {
  return { content: [{ type: 'text', text: message }] };
}

function formatError(error) {
  return {
    content: [{ type: 'text', text: `Error: ${error}` }],
    isError: true
  };
}

function escapePromptText(value, maxLength = 200) {
  return String(value || '')
    .replace(PROMPT_INJECTION_PATTERNS[0], '[filtered]')
    .replace(PROMPT_INJECTION_PATTERNS[1], '[filtered]')
    .replace(PROMPT_INJECTION_PATTERNS[2], '[filtered]')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\r/g, ' ')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, ' ')
    .slice(0, maxLength)
    .trim() || 'Unknown';
}

function summarizePromptField(value, maxLength, fallback) {
  const escaped = escapePromptText(value, maxLength);
  return escaped || fallback;
}

async function assertWritableSkillTarget(workspace, filePath) {
  const skillsRoot = path.join(workspace, 'skills');
  await rejectSymlink(filePath);

  const resolvedRoot = await fs.promises.realpath(skillsRoot);
  const resolvedFile = await fs.promises.realpath(filePath);
  if (!resolvedFile.startsWith(ensureTrailingSep(resolvedRoot))) {
    throw new Error('resolved skill path escapes workspace/skills');
  }
}

async function rejectSymlink(targetPath) {
  const stat = await fs.promises.lstat(targetPath);
  if (stat.isSymbolicLink()) {
    throw new Error(`symbolic link is not allowed: ${targetPath}`);
  }
}

function ensureTrailingSep(value) {
  return value.endsWith(path.sep) ? value : value + path.sep;
}

module.exports = plugin;
module.exports.buildSkillContent = buildSkillContent;
module.exports.buildReviewPrompt = buildReviewPrompt;
