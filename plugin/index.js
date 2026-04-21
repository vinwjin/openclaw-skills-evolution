/**
 * OpenClaw Skills Evolution Plugin
 * v0.3: 对标 Hermes Skills 自我进化机制。
 *
 * 核心功能：注册三个工具，让 OpenClaw Agent 在任务中主动沉淀经验。
 * - skill_manage: 创建/编辑/补丁/删除 SKILL.md
 * - skill_list: 列出所有 Skills
 * - skill_search: 关键词搜索 Skills
 *
 * Skills 存储路径：~/.openclaw/workspace/skills/{safeName}/SKILL.md
 */

const { SkillLoader } = require('./lib/skill-loader');
const { SkillSaver } = require('./lib/skill-saver');
const { SkillIndex } = require('./lib/skill-index');

// ============================================================================
// Plugin Definition
// ============================================================================

const plugin = {
  id: 'skills-evolution',
  name: 'Skills Evolution',
  description: 'Skills 自我进化系统 — Agent 主动沉淀经验为可复用 SKILL.md',

  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {}
  },

  register(api) {
    // -------------------------------------------------------------------------
    // Tool: skill_manage
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

    // -------------------------------------------------------------------------
    // Tool: skill_list
    // -------------------------------------------------------------------------
    api.registerTool({
      name: 'skill_list',
      description: '列出所有可用的 Skills，显示名称和描述。',
      parameters: {
        type: 'object',
        properties: {}
      },

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

    // -------------------------------------------------------------------------
    // Tool: skill_search
    // -------------------------------------------------------------------------
    api.registerTool({
      name: 'skill_search',
      description: '在 Skills 中搜索关键词，返回匹配的 Skills 列表。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词'
          }
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
// Tool Handlers
// ============================================================================

async function handleCreate(name, content) {
  if (!content) {
    return formatError("content is required for action='create'");
  }

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
  if (!content) {
    return formatError("content is required for action='edit'");
  }

  const workspace = getWorkspace();
  const found = await findByName(name, workspace);

  if (!found) {
    return formatError(`Skill '${name}' not found.`);
  }

  try {
    fs.writeFileSync(found.path, content, 'utf-8');
    return formatResult(`Skill '${name}' updated.`);
  } catch (e) {
    return formatError(`Failed to update skill: ${e.message}`);
  }
}

async function handlePatch(name, old_string, new_string) {
  if (!old_string) {
    return formatError("old_string is required for action='patch'");
  }

  const workspace = getWorkspace();
  const found = await findByName(name, workspace);

  if (!found) {
    return formatError(`Skill '${name}' not found.`);
  }

  try {
    let content = fs.readFileSync(found.path, 'utf-8');

    if (!content.includes(old_string)) {
      return formatError('old_string not found in skill content. Check whitespace.');
    }

    content = content.replace(old_string, new_string || '');
    fs.writeFileSync(found.path, content, 'utf-8');
    return formatResult(`Skill '${name}' patched.`);
  } catch (e) {
    return formatError(`Failed to patch skill: ${e.message}`);
  }
}

async function handleDelete(name) {
  const workspace = getWorkspace();
  const found = await findByName(name, workspace);

  if (!found) {
    return formatError(`Skill '${name}' not found.`);
  }

  try {
    fs.rmSync(found.skillDir, { recursive: true });
    return formatResult(`Skill '${name}' deleted.`);
  } catch (e) {
    return formatError(`Failed to delete skill: ${e.message}`);
  }
}

// ============================================================================
// Helpers
// ============================================================================

const fs = require('fs');

function getWorkspace() {
  return process.env.HOME + '/.openclaw/workspace';
}

async function findByName(name, workspace) {
  const loader = new SkillLoader();
  await loader.loadAll(workspace);

  for (const skill of loader.getLoaded()) {
    if (skill.name === name) {
      return {
        path: skill.path,
        skillDir: pathDir(skill.path)
      };
    }
  }
  return null;
}

function pathDir(p) {
  return p.replace(/[/\\][^/\\]+$/, '');
}

function parseSkillContent(skill) {
  const nameMatch = skill.content.match(/^name:\s*(.+)$/m);
  const descMatch = skill.content.match(/^description:\s*(.+)$/m);
  return {
    name: nameMatch ? nameMatch[1].trim() : skill.name,
    description: descMatch ? descMatch[1].trim() : '',
    triggers: [],
    actions: []
  };
}

function formatResult(message) {
  return { content: [{ type: 'text', text: message }] };
}

function formatError(error) {
  return { content: [{ type: 'text', text: `Error: ${error}` }] };
}

module.exports = plugin;
