/**
 * OpenClaw Skills Evolution Plugin
 * v0.4: 双轨沉淀机制
 *
 * 轨道1：Agent 主动调用 skill_manage 沉淀（工具模式）
 * 轨道2：session_end 时自动审视 → before_prompt_build 注入机会 → Agent 决定是否创建 skill
 *
 * 核心思路：
 * - session_end hook 只做一件事：读取 session JSONL，生成摘要，存入全局注册表
 * - before_prompt_build hook 检查是否有待审视的 session，有则注入简短提示
 * - 注入的提示让 Agent 在下一个 turn 开头有机会主动调用 skill_manage
 * - 全程 Agent 自主决策，不做全自动沉淀
 */

const fs = require('fs');
const { SkillLoader } = require('./lib/skill-loader');
const { SkillSaver } = require('./lib/skill-saver');
const { SkillIndex } = require('./lib/skill-index');
const { SessionSummarizer } = require('./lib/session-summarizer');

// ============================================================================
// 全局 session 摘要注册表
// { sessionId: { topic, tools, keyFindings, timestamp } }
// ============================================================================
const sessionRegistry = new Map();

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
    // 轨道2-A：session_end — 提取 session 摘要
    // -------------------------------------------------------------------------
    api.on('session_end', async (event, ctx) => {
      // sessionId 优先从 ctx 取（event 上的字段不稳定）
      const sessionId = ctx?.sessionId || event.sessionId || event.session?.id;
      const sessionFile = event.sessionFile;

      if (!sessionFile || !sessionId) return;

      try {
        // 读取并摘要 session
        const summarizer = new SessionSummarizer();
        const summary = await summarizer.summarize(sessionFile);
        if (!summary) return;

        // 存入注册表，标记为待审视
        sessionRegistry.set(sessionId, {
          ...summary,
          timestamp: Date.now()
        });

        console.error(`[skills-evolution] session_end: ${sessionId} — topic="${summary?.topic || 'none'}"`);
      } catch (err) {
        console.error(`[skills-evolution] session_end error: ${sessionId} — ${err.message}`);
      }
    });

    // -------------------------------------------------------------------------
    // 轨道2-B：before_prompt_build — 注入审视机会
    // event: { prompt, messages }, ctx: { sessionId, ... }
    // 返回 { appendSystemContext } 让 OpenClaw 追加到 system prompt
    // -------------------------------------------------------------------------
    api.on('before_prompt_build', async (event, ctx) => {
      // sessionId 来自 ctx，不是 event
      const sessionId = ctx?.sessionId;
      if (!sessionId) return;

      const entry = sessionRegistry.get(sessionId);
      if (!entry) return;

      // 注入审视提示
      const reviewPrompt = buildReviewPrompt(entry);

      // 返回 appendSystemContext，OpenClaw 会追加到 system prompt 末尾
      // 清除标记，避免重复注入
      sessionRegistry.delete(sessionId);

      return { appendSystemContext: reviewPrompt };
    });

    // -------------------------------------------------------------------------
    // 轨道1：三个工具注册
    // -------------------------------------------------------------------------
    api.registerTool({
      name: 'skill_manage',
      description:
        '管理 Skills — 创建新 Skill 或更新已有 Skill。' +
        'Skills 是可重用的工作流文档，存储在 ~/.openclaw/workspace/skills/。' +
        '当发现复杂问题的解决方案、反复出现的任务模式、或被纠正的错误时，创建 Skill。',
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
            description: "完整 SKILL.md 内容（YAML frontmatter + Markdown）。用于 action='create' 或 'edit'。"
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
        const { action, name, content, old_string, new_string } = params;

        if (action === 'create') return handleCreate(name, content);
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
  }
};

// ============================================================================
// Helpers
// ============================================================================

function buildReviewPrompt(entry) {
  const { topic, tools, keyFindings } = entry;
  const toolList = tools.length > 0 ? `工具: ${tools.join(', ')}` : '';

  return `
## 经验审视机会

上一个 session 主题：**${topic}**
${toolList}

如果这个 session 中发现了值得复用的解决方案、反复出现的模式、或被纠正的错误，考虑调用 skill_manage create 沉淀为 SKILL.md。
`;
}

async function handleCreate(name, content) {
  if (!content) return formatError("content is required for action='create'");

  const saver = new SkillSaver();
  const workspace = getWorkspace();

  try {
    await saver.save(workspace, { name, content });
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

  for (const skill of loader.getLoaded()) {
    if (skill.name === name) {
      return { path: skill.path, skillDir: pathDir(skill.path) };
    }
  }
  return null;
}

function pathDir(p) {
  return p.replace(/[/\\][^/\\]+$/, '');
}

function parseSkillContent(skill) {
  const frontmatter = skill.frontmatter || {};
  return {
    name: frontmatter.name || skill.name,
    description: frontmatter.description || '',
    triggers: Array.isArray(frontmatter.triggers) ? frontmatter.triggers : [],
    actions: []
  };
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

module.exports = plugin;
