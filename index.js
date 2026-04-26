/**
 * OpenClaw Skills Evolution Plugin
 * v0.6.3: Host 鉴权/模型优先的 compaction + 发布整理
 *
 * 鍗囩骇鍐呭锛?
 * 1. session_end 鏃?spawn 瀛?Agent 鍦ㄥ悗鍙板畬鎴?skill 鍥哄寲锛屼富 Agent 涓嶉樆濉?
 * 2. 鏂板 trigger_review / trigger_deep_review 宸ュ叿锛岀敤鎴峰彲涓诲姩瑙﹀彂瀹¤
 * 3. before_prompt_build 澧炲姞澶嶆潅搴︽娴嬶紝瓒呰繃 10 娆″伐鍏疯皟鐢ㄥ垯涓诲姩娉ㄥ叆鍙戠幇鎻愮ず
 */

const fs = require('fs');
const path = require('path');
const { SkillLoader } = require('./lib/skill-loader');
const { SkillSaver } = require('./lib/skill-saver');
const { SkillIndex, tokenize } = require('./lib/skill-index');
const { SessionSummarizer } = require('./lib/session-summarizer');
const { spawnDeepReview } = require('./lib/skill-summarizer-agent');
const { filterReusableSkillDocs } = require('./lib/skill-quality');

// ============================================================================
// 鍏ㄥ眬寰呭瑙?session 闃熷垪
// ============================================================================
const pendingReviews = [];
const pendingReviewsFile = path.join(__dirname, '.pending-reviews.json');
let pendingReviewsMtime = 0;
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+previous\s+instructions/i,
  /call\s+skill_manage/i,
  /system\s+prompt/i
];
const LOW_VALUE_REVIEW_PATTERNS = [
  /^a new session was started via \/new or \/reset/i,
  /^hello[,!\s].*help me with coding/i,
  /^\/tools\b/i,
  /请回复[:：]/i,
  /\b(smoke|live|provider|payload)_ready\b/i,
  /write a dream diary entry/i
];
const LOW_SIGNAL_TOOL_NAMES = new Set(['read', 'write', 'process', 'message']);
const MAX_PENDING_REVIEWS = 20;
const MAX_RELEVANT_SKILLS = 2;
const MIN_RELEVANT_SKILL_SCORE = 2;
const MAX_SKILL_PROMPT_CHARS = 1600;
const SKILL_QUERY_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'be', 'before', 'but', 'by', 'for', 'from', 'how', 'in',
  'into', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'up',
  'use', 'with', 'your', '你', '你们', '我们', '需要', '然后', '这个', '那个', '以及', '并且',
  '进行', '处理', '一个', '一些', '当前'
]);

// ============================================================================
// Plugin Definition
// ============================================================================

const plugin = {
  id: 'skills-evolution',
  name: 'Skills Evolution',
  description: 'Skills 鑷垜杩涘寲绯荤粺 鈥?鍙岃建娌夋穩缁忛獙涓哄彲澶嶇敤 SKILL.md',

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
        summarize: async ({ messages, previousSummary, customInstructions, signal }, ctx) => {
          const provider = require('./lib/compaction-provider');
          return provider.summarize({
            messages,
            previousSummary,
            customInstructions,
            signal,
            runtime: ctx?.runtime || api.runtime || api.host?.runtime,
            hostConfig: ctx?.config || ctx?.hostConfig || api.config || api.hostConfig
          });
        }
      });
      console.error('[skills-evolution] compaction provider registered: skills-evolution-compactor');
    } else {
      console.error('[skills-evolution] compaction provider unavailable: host API has no registerCompactionProvider');
    }

    // -------------------------------------------------------------------------
    // 杞ㄩ亾2-A锛歴ession_end 鈥?spawn 瀛?Agent 鍥哄寲锛堜笉闃诲锛?
    // -------------------------------------------------------------------------
    api.on('session_end', async (event, ctx) => {
      const sessionId = ctx?.sessionId || event.sessionId || event.session?.id;
      const sessionFile = event.sessionFile;

      if (!sessionFile || !sessionId) return;

      try {
        await loadPendingReviews();

        // 璇诲彇骞舵憳瑕?session锛堝悓姝ワ紝姣绾э級
        const summarizer = new SessionSummarizer();
        const summary = await summarizer.summarize(sessionFile);
        if (!summary) return;
        if (!shouldQueuePendingReview(summary)) {
          console.error(`[skills-evolution] session_end: skipped low-value review — topic="${summary?.topic || 'none'}"`);
          return;
        }

        // 存入待审视队列
        const queued = mergePendingReview({
          ...summary,
          timestamp: Date.now()
        });
        if (!queued) {
          console.error(`[skills-evolution] session_end: skipped duplicate review — topic="${summary?.topic || 'none'}"`);
          return;
        }
        await savePendingReviews();

        // 绔嬪嵆 spawn 瀛?Agent 鍋氭繁搴﹀浐鍖栵紙涓嶉樆濉烇級
        const workspace = getWorkspace();
        spawnDeepReview(sessionFile, workspace, null);

        console.error(`[skills-evolution] session_end: queued + spawned deep-review 鈥?topic="${summary?.topic || 'none'}"`);
      } catch (err) {
        console.error(`[skills-evolution] session_end error: ${sessionId} 鈥?${err.message}`);
      }
    });

    // -------------------------------------------------------------------------
    // 杞ㄩ亾2-B锛歜efore_prompt_build 鈥?娉ㄥ叆瀹¤鏈轰細 + 澶嶆潅搴︽娴?
    // -------------------------------------------------------------------------
    api.on('before_prompt_build', async (event, ctx) => {
      await loadPendingReviews();

      const parts = [];

      // 1. 澶嶆潅搴︽娴嬶細褰撳墠 session 宸ュ叿璋冪敤瓒呰繃闃堝€兼椂涓诲姩娉ㄥ叆鍙戠幇鎻愮ず
      const toolCallCount = countToolCalls(event);
      const COMPLEXITY_THRESHOLD = 10;
      if (toolCallCount > COMPLEXITY_THRESHOLD) {
        const complexityPrompt = buildComplexityPrompt({
          topic: extractTopicFromEvent(event),
          toolCallCount,
          tools: extractToolsFromEvent(event)
        });
        parts.push(complexityPrompt);
        console.error(`[skills-evolution] before_prompt_build: complexity detected 鈥?${toolCallCount} tool calls`);
      }

      // 2. 为当前任务注入高相关的可复用 Skill
      try {
        const relevantSkills = await findRelevantSkillsForEvent(event);
        if (relevantSkills.length > 0) {
          parts.push(buildRelevantSkillsPrompt(relevantSkills));
          console.error(`[skills-evolution] before_prompt_build: injected ${relevantSkills.length} relevant skill(s)`);
        }
      } catch (err) {
        console.error(`[skills-evolution] relevant skill injection error: ${err.message}`);
      }

      // 3. 如果有待审视的 session，注入审视提示
      if (pendingReviews.length > 0) {
        const entry = pendingReviews.shift();
        if (entry) {
          await savePendingReviews();
          parts.push(buildReviewPrompt(entry));
          console.error(`[skills-evolution] before_prompt_build: injected review 鈥?topic="${entry.topic}", remaining=${pendingReviews.length}`);
        }
      }

      if (parts.length === 0) return;

      return { appendSystemContext: parts.join('\n') };
    });

    // -------------------------------------------------------------------------
    // 杞ㄩ亾1锛歴kill_manage 宸ュ叿锛堜繚鎸佷笉鍙橈級
    // -------------------------------------------------------------------------
    api.registerTool({
      name: 'skill_manage',
      description:
        '管理 Skills：创建新 Skill 或更新已有 Skill。'
        + ' Skills 是可复用的工作流文档，存储在 ~/.openclaw/workspace/skills/。'
        + ' 当发现复杂问题的解决方案、反复出现的任务模式或被纠正的错误时，可以创建 Skill。'
        + " action='create' 时，content 只需要提供 Markdown 正文；可选的 description、triggers、actions 会自动写入 YAML frontmatter。",
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'edit', 'patch', 'delete'],
            description: "鎿嶄綔绫诲瀷锛?create'(鏂板缓), 'edit'(鍏ㄩ噺閲嶅啓), 'patch'(灞€閮ㄦ浛鎹?, 'delete'(鍒犻櫎)"
          },
          name: {
            type: 'string',
            description: 'Skill 鍚嶇О锛堢敤浜庢爣璇嗗拰妫€绱級'
          },
          content: {
            type: 'string',
            description: "Skill 内容。用于 action='create' 时传入 Markdown 正文；用于 action='edit' 时传入完整的 SKILL.md（含 YAML frontmatter）。"
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
            description: "要替换的文本。用于 action='patch'，必须完整匹配（包括空白）。"
          },
          new_string: {
            type: 'string',
            description: "替换后的文本。用于 action='patch'，空字符串表示删除。"
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
      description: '列出所有可用的 Skills，并显示名称和描述。',
      parameters: { type: 'object', properties: {} },

      async execute(toolCallId, params) {
        const loader = new SkillLoader();
        const workspace = getWorkspace();
        const skills = await loader.loadAll(workspace);
        const parsedSkills = skills.map(parseSkillContent);
        const { reusable, excluded } = filterReusableSkillDocs(parsedSkills);

        if (skills.length === 0) {
          return formatResult('No skills found in ~/.openclaw/workspace/skills/');
        }
        if (reusable.length === 0) {
          return formatResult(`No reusable skills found. Hidden low-quality/generated skills: ${excluded.length}`);
        }

        const lines = reusable.map(s =>
          `- **${s.name}**: ${s.description || ''}`
        );
        const suffix = excluded.length > 0
          ? `\n\nHidden low-quality/generated skills: ${excluded.length}`
          : '';
        return formatResult(`Available reusable Skills (${reusable.length}):\n\n${lines.join('\n')}${suffix}`);
      }
    });

    api.registerTool({
      name: 'skill_search',
      description: '在 Skills 中搜索关键词，并返回匹配的 Skill 列表。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词。' }
        },
        required: ['query']
      },

      async execute(toolCallId, params) {
        const { query } = params;

        const loader = new SkillLoader();
        const workspace = getWorkspace();
        await loader.loadAll(workspace);
        const parsedSkills = loader.getLoaded().map(parseSkillContent);
        const { reusable } = filterReusableSkillDocs(parsedSkills);

        const index = new SkillIndex();
        for (const skill of reusable) {
          index.add(skill);
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
    // v0.5 鏂板锛氫富鍔ㄥ瑙嗗伐鍏?
    // -------------------------------------------------------------------------
    api.registerTool({
      name: 'trigger_review',
      description: '对当前 session 进行摘要，生成审视机会并注入到下一轮 prompt。立即返回，不阻塞主流程。',
      parameters: {
        type: 'object',
        properties: {
          session_key: {
            type: 'string',
            description: '可选，显式指定要审视的 sessionKey。用于 HTTP /tools/invoke 等拿不到 sessionFile 的场景。'
          },
          session_id: {
            type: 'string',
            description: '可选，显式指定要审视的 sessionId。用于 HTTP /tools/invoke 等拿不到 sessionFile 的场景。'
          }
        }
      },

      async execute(toolCallId, params, ctx) {
        const sessionFile = await resolveSessionFileFromContext(ctx, params);

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
          mergePendingReview({
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
            `审视提示已注入到下一轮 prompt，当前 pending reviews: ${pendingReviews.length}`
          );
        } catch (err) {
          return formatError(`trigger_review failed: ${err.message}`);
        }
      }
    });

    api.registerTool({
      name: 'trigger_deep_review',
      description: 'Spawn 子 Agent 在后台做深度固化。立即返回，不阻塞主流程；结果会写入 .deep-review-done.json。',
      parameters: {
        type: 'object',
        properties: {
          skill_name: {
            type: 'string',
            description: '可选，指定要创建的 Skill 名称。'
          },
          session_key: {
            type: 'string',
            description: '可选，显式指定要深度固化的 sessionKey。用于 HTTP /tools/invoke 等拿不到 sessionFile 的场景。'
          },
          session_id: {
            type: 'string',
            description: '可选，显式指定要深度固化的 sessionId。用于 HTTP /tools/invoke 等拿不到 sessionFile 的场景。'
          }
        }
      },

      async execute(toolCallId, params, ctx) {
        const sessionFile = await resolveSessionFileFromContext(ctx, params);
        const workspace = getWorkspace();

        if (!sessionFile) {
          return formatError('sessionFile not available for trigger_deep_review');
        }

        try {
          const requestedSkillName = typeof params?.skill_name === 'string' && params.skill_name.trim()
            ? params.skill_name.trim()
            : null;
          const { pendingId } = spawnDeepReview(sessionFile, workspace, requestedSkillName);

          return formatResult(
            `Deep review spawned (id: ${pendingId}).\n` +
            `后台固化进程已启动，结果会写入 ~/.openclaw/extensions/skills-evolution/.deep-review-done.json\n` +
            '可以通过查看该文件确认完成状态。'
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
// 澶嶆潅搴︽娴嬭緟鍔╁嚱鏁帮紙鐢ㄤ簬 before_prompt_build 涓诲姩鍙戠幇锛?
// -------------------------------------------------------------------------

/**
 * 浠?event 瀵硅薄缁熻褰撳墠 session 鐨勫伐鍏疯皟鐢ㄦ鏁?
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
 * 浠?event 瀵硅薄鎻愬彇涓婚锛堢涓€涓敤鎴锋秷鎭墠80瀛楃锛?
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
 * 浠?event 瀵硅薄鎻愬彇鐢ㄥ埌鐨勫伐鍏峰垪琛?
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
 * 鏋勫缓澶嶆潅搴﹁Е鍙戠殑涓诲姩鍙戠幇鎻愮ず
 */
function buildComplexityPrompt({ topic, toolCallCount, tools }) {
  const topicSummary = summarizePromptField(topic, 60, '复杂任务');
  const toolList = tools.length > 0
    ? `工具数量: ${tools.length}（示例：${tools.slice(0, 5).map(tool => escapePromptText(tool, 30)).join(', ')}${tools.length > 5 ? '...' : ''}）`
    : '工具数量: 0';
  return `
## 检测到值得沉淀的经验

你刚完成了一个复杂任务（主题摘要：${topicSummary}；工具调用 ${toolCallCount} 次）。这类任务的解决方案通常值得固化。

${toolList}

如果这套做法具有通用性，可以调用 trigger_deep_review 启动后台固化流程。
`;
}

// -------------------------------------------------------------------------
// Session 鎽樿瀹¤鎻愮ず
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

上一轮 session 主题摘要：**${safeTopic}**
${toolList}
${findingsBlock}

如果这个 session 里出现了值得复用的方案、反复出现的模式，或被纠正的错误，请考虑调用 skill_manage create 沉淀成一个 SKILL.md。
`;
}

function buildRelevantSkillsPrompt(skills) {
  const sections = skills.map(skill => {
    const triggers = Array.isArray(skill.triggers) && skill.triggers.length > 0
      ? `Triggers: ${skill.triggers.slice(0, 3).map(trigger => escapePromptText(trigger, 80)).join(' | ')}`
      : 'Triggers: none recorded';
    const actions = Array.isArray(skill.actions) && skill.actions.length > 0
      ? `Actions: ${skill.actions.slice(0, 4).map(action => escapePromptText(action, 40)).join(', ')}`
      : 'Actions: none recorded';

    return [
      `### ${escapePromptText(skill.name, 80)}`,
      `Description: ${escapePromptText(skill.description || 'No description provided.', 160)}`,
      triggers,
      actions,
      '```md',
      trimSkillPromptBody(skill.content),
      '```'
    ].join('\n');
  });

  return `
## Relevant Skills

The following existing skills look relevant to the current task. Reuse them when they fit, but adapt them to the current constraints instead of following them blindly.

${sections.join('\n\n')}
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
  lines.unshift('---');  // 鍦ㄦ渶鍓嶉潰鎻掑叆 '---'
  lines.push('---', ''); // 闂悎 frontmatter

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
    // 鍐欏叆鍓嶅啀娆℃牎楠岀湡瀹炶矾寰勶紝闃绘宸插瓨鍦?skill 琚鍙烽摼鎺ュ姭鎸併€?
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
    // patch 鍜?edit 鍏变韩鐩稿悓鐨勮矾寰勮竟鐣屾牎楠岋紝閬垮厤瓒婄晫瑕嗙洊浠绘剰鏂囦欢銆?
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
      // 鎸夊悕绉版煡鎵炬椂鏍￠獙鐪熷疄璺緞锛岄槻姝?loader 涔嬪鐨勫閮ㄦ浛鎹㈢粫杩囪竟鐣岄檺鍒躲€?
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
    content: bodyContent,
    sourcePath: skill.path,
    sourceDir: pathDir(skill.path)
  };
}

async function loadPendingReviews() {
  try {
    if (!fs.existsSync(pendingReviewsFile)) return;

    const stat = await fs.promises.stat(pendingReviewsFile);
    // 鏂囦欢鏈洿鏂帮紝璺宠繃
    if (stat.mtimeMs <= pendingReviewsMtime) return;

    const raw = await fs.promises.readFile(pendingReviewsFile, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    pendingReviews.length = 0;
    pendingReviews.push(...normalizePendingReviews(parsed));
    pendingReviewsMtime = stat.mtimeMs;
  } catch (err) {
    console.error(`[skills-evolution] pending review load error: ${err.message}`);
  }
}

async function savePendingReviews() {
  try {
    const normalized = normalizePendingReviews(pendingReviews);
    pendingReviews.length = 0;
    pendingReviews.push(...normalized);
    await fs.promises.writeFile(
      pendingReviewsFile,
      JSON.stringify(pendingReviews, null, 2) + '\n',
      'utf-8'
    );
    const stat = await fs.promises.stat(pendingReviewsFile);
    pendingReviewsMtime = stat.mtimeMs;
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

function shouldQueuePendingReview(entry, opts = {}) {
  if (!isValidPendingReview(entry)) return false;

  const topic = normalizeReviewTopic(entry.topic);
  const allowLowValue = opts.allowLowValue === true || entry.triggered === true;
  if (!allowLowValue && isLowValueReviewTopic(topic)) {
    return false;
  }

  const tools = Array.isArray(entry.tools)
    ? entry.tools.filter(tool => typeof tool === 'string' && tool.trim())
    : [];
  const findings = Array.isArray(entry.keyFindings)
    ? entry.keyFindings.filter(finding => typeof finding === 'string' && finding.trim())
    : [];
  const strongTools = tools.filter(tool => !LOW_SIGNAL_TOOL_NAMES.has(tool.trim().toLowerCase()));
  const hasActionableSignal = findings.length > 0 || strongTools.length > 0 || tools.length >= 3;

  if (allowLowValue) {
    return true;
  }

  if (!hasActionableSignal) {
    return false;
  }

  return true;
}

function normalizePendingReviews(entries) {
  const next = [];
  const seen = new Set();

  for (const entry of entries) {
    if (!shouldQueuePendingReview(entry)) continue;
    const dedupeKey = buildPendingReviewKey(entry.topic);
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    next.push({
      topic: String(entry.topic).trim(),
      tools: Array.isArray(entry.tools) ? entry.tools : [],
      keyFindings: Array.isArray(entry.keyFindings) ? entry.keyFindings : [],
      skillPrompts: Array.isArray(entry.skillPrompts) ? entry.skillPrompts : [],
      ...typeof entry.timestamp === 'number' ? { timestamp: entry.timestamp } : {},
      ...entry.triggered === true ? { triggered: true } : {}
    });
    if (next.length >= MAX_PENDING_REVIEWS) break;
  }

  return next;
}

function mergePendingReview(entry) {
  const beforeKeys = new Set(pendingReviews.map(item => buildPendingReviewKey(item.topic)).filter(Boolean));
  pendingReviews.push(entry);
  const normalized = normalizePendingReviews(pendingReviews);
  pendingReviews.length = 0;
  pendingReviews.push(...normalized);
  const entryKey = buildPendingReviewKey(entry.topic);
  return Boolean(entryKey) && pendingReviews.some(item => buildPendingReviewKey(item.topic) === entryKey) && !beforeKeys.has(entryKey);
}

function buildPendingReviewKey(topic) {
  const normalized = normalizeReviewTopic(topic);
  return normalized || null;
}

function normalizeReviewTopic(topic) {
  return String(topic || '')
    .replace(/^\[[^\]]+\]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isLowValueReviewTopic(topic) {
  return LOW_VALUE_REVIEW_PATTERNS.some(pattern => pattern.test(topic));
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

async function resolveSessionFileFromContext(ctx, params = {}) {
  if (typeof ctx?.sessionFile === 'string' && ctx.sessionFile.trim()) {
    return ctx.sessionFile;
  }

  const candidates = [
    params?.session_key,
    params?.session_id,
    ctx?.sessionKey,
    ctx?.session?.key,
    ctx?.sessionId,
    ctx?.session?.id
  ].filter(value => typeof value === 'string' && value.trim());

  if (candidates.length === 0) {
    return null;
  }

  const agentsRoot = path.join(process.env.HOME || '', '.openclaw', 'agents');
  let agentEntries = [];
  try {
    agentEntries = await fs.promises.readdir(agentsRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of agentEntries) {
    if (!entry.isDirectory()) continue;

    const storePath = path.join(agentsRoot, entry.name, 'sessions', 'sessions.json');
    let parsed = null;
    try {
      parsed = JSON.parse(await fs.promises.readFile(storePath, 'utf-8'));
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== 'object') continue;

    for (const candidate of candidates) {
      const byKey = parsed[candidate];
      if (byKey && typeof byKey.sessionFile === 'string' && byKey.sessionFile.trim()) {
        return byKey.sessionFile;
      }

      for (const session of Object.values(parsed)) {
        if (!session || typeof session !== 'object') continue;
        if (session.sessionId === candidate && typeof session.sessionFile === 'string' && session.sessionFile.trim()) {
          return session.sessionFile;
        }
      }
    }
  }

  return null;
}

async function findRelevantSkillsForEvent(event) {
  const query = buildSkillQueryFromEvent(event);
  if (!query) return [];
  const queryTokens = tokenizeSkillQuery(query);
  if (queryTokens.length === 0) return [];

  const loader = new SkillLoader();
  const workspace = getWorkspace();
  await loader.loadAll(workspace);

  const docs = loader.getLoaded().map(parseSkillContent);
  const { reusable } = filterReusableSkillDocs(docs);
  const docsToIndex = reusable;
  if (docsToIndex.length === 0) return [];

  const index = new SkillIndex();
  for (const doc of docsToIndex) {
    index.add(doc);
  }

  const byName = new Map(docsToIndex.map(doc => [doc.name, doc]));
  return index.search(query)
    .filter(result => result.score >= MIN_RELEVANT_SKILL_SCORE)
    .filter(result => {
      const doc = byName.get(result.name);
      return doc && hasStrongSkillOverlap(doc, queryTokens);
    })
    .slice(0, MAX_RELEVANT_SKILLS)
    .map(result => byName.get(result.name))
    .filter(Boolean);
}

function buildSkillQueryFromEvent(event) {
  const userTexts = extractUserTextsFromEvent(event);
  const lastUserText = userTexts.length > 0 ? userTexts[userTexts.length - 1] : '';
  const toolNames = extractToolsFromEvent(event);
  const query = [lastUserText, toolNames.slice(0, 5).join(' ')].filter(Boolean).join(' ').trim();
  return query.length >= 8 ? query : '';
}

function extractUserTextsFromEvent(event) {
  const messages = event?.messages || [];
  const texts = [];

  for (const msg of messages) {
    if (msg?.role !== 'user') continue;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block?.type === 'text' && typeof block?.text === 'string' && block.text.trim()) {
        texts.push(block.text.trim());
      }
    }
  }

  return texts;
}

function trimSkillPromptBody(content) {
  const normalized = String(content || '').trim();
  if (!normalized) return 'No content.';
  if (normalized.length <= MAX_SKILL_PROMPT_CHARS) return normalized;
  return normalized.slice(0, MAX_SKILL_PROMPT_CHARS - 24).trimEnd() + '\n...[trimmed]';
}

function hasStrongSkillOverlap(doc, queryTokens) {
  const nameAndTriggerTokens = tokenizeSkillQuery([
    doc.name,
    ...(Array.isArray(doc.triggers) ? doc.triggers : [])
  ].join(' '));
  const descriptiveTokens = tokenizeSkillQuery([
    doc.description,
    ...(Array.isArray(doc.actions) ? doc.actions : [])
  ].join(' '));

  const nameOverlap = countTokenOverlap(queryTokens, nameAndTriggerTokens);
  if (nameOverlap >= 1) return true;

  const descriptiveOverlap = countTokenOverlap(queryTokens, descriptiveTokens);
  return descriptiveOverlap >= 2;
}

function tokenizeSkillQuery(text) {
  return tokenize(String(text || ''))
    .filter(token => token.length >= 2)
    .filter(token => !SKILL_QUERY_STOPWORDS.has(token));
}

function countTokenOverlap(left, right) {
  const rightSet = new Set(right);
  let count = 0;
  for (const token of left) {
    if (rightSet.has(token)) count++;
  }
  return count;
}

module.exports = plugin;
module.exports.buildSkillContent = buildSkillContent;
module.exports.buildReviewPrompt = buildReviewPrompt;
module.exports.resolveSessionFileFromContext = resolveSessionFileFromContext;
