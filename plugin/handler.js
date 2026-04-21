/**
 * OpenClaw Skill Wall Plugin
 *
 * Aligns OpenClaw with Hermes Agent's self-evolving skill system.
 * Provides: Skill System Prompt injection + skill_editor tool + session analysis.
 *
 * Architecture (aligned with openclaw-lark pattern):
 * - Skills are discovered natively by OpenClaw from ~/.openclaw/workspace/skills/
 * - This plugin enhances the Agent's awareness via system prompt + provides management tools
 * - No background injection — Agent sees skills index and knows how to use them
 */

// ---------------------------------------------------------------------------
// Phase 1: Skill System Prompt Injection (before_prompt_build)
// ---------------------------------------------------------------------------

/**
 * Build the Skill System Prompt text (matches Hermes Agent's skill awareness).
 * Returned as prependSystemContext to go into the system prompt with caching.
 */
function buildSkillSystemPrompt() {
  return `## Skills (mandatory)

Before replying, scan the skills below. If a skill matches or is even partially
relevant to your task, apply it. Prefer established skills over inventing new
workflows.

Skills directory: ~/.openclaw/workspace/skills/
Skill format: SKILL.md with YAML frontmatter (name, description, triggers).

**Skill discovery flow:**
1. When assigned a task, first check ~/.openclaw/workspace/skills/ for relevant skills
2. Use pattern matching: skill name/description tags vs. current task keywords
3. If relevant skill found, load and follow its guidance
4. After complex tasks, consider creating/updating a skill via skill_editor

**Skill editor tool** (skill_editor):
- Use action='patch' for targeted fixes (preferred — preserves structure)
- Use action='edit' for full rewrites
- After patching a skill, it becomes immediately available for future tasks

**When to create a skill:**
- Complex multi-step workflow discovered through trial and error
- Recurring task pattern with proven approach
- Non-obvious tool combination or parameters

**When to patch a skill:**
- Skill exists but is missing steps you discovered
- Tool parameters changed, outdated instruction
- Edge case found that skill should handle`;
}

// ---------------------------------------------------------------------------
// Phase 2: Skill Editor Tool
// ---------------------------------------------------------------------------

const { parseFrontmatter } = require('./lib/skill-generator');

/**
 * Get the OpenClaw skills directory path.
 * @returns {string}
 */
function getOpenClawSkillsPath() {
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  return `${home}/.openclaw/workspace/skills/`;
}

/**
 * Find a skill by name in the skills directory (recursive).
 * @param {string} name
 * @param {string} skillsDir
 * @returns {Promise<{path: string, skillDir: string}|null>}
 */
async function findSkillByName(name, skillsDir) {
  const fs = await import('fs');
  const path = await import('path');
  return findSkillByNameInDir(name, skillsDir, fs, path);
}

async function findSkillByNameInDir(name, dir, fs, path) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(dir, entry.name);
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (fs.existsSync(skillMdPath)) {
      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const parsed = parseFrontmatter(content);
        if (parsed.frontmatter?.name === name) {
          return { path: skillMdPath, skillDir };
        }
      } catch {
        // Skip
      }
    }
    const subResult = await findSkillByNameInDir(name, skillDir, fs, path);
    if (subResult) return subResult;
  }
  return null;
}

/**
 * Validate that content has proper frontmatter with required fields.
 * @param {string} content
 * @returns {{valid: boolean, error?: string}}
 */
function validateFrontmatterForEdit(content) {
  if (!content || !content.trim()) {
    return { valid: false, error: 'Content cannot be empty.' };
  }
  if (!content.startsWith('---')) {
    return { valid: false, error: 'SKILL.md must start with YAML frontmatter (---).' };
  }
  const endMatch = content.match(/\n---\s*\n/);
  if (!endMatch) {
    return { valid: false, error: 'SKILL.md frontmatter is not closed. Ensure you have a closing --- line.' };
  }
  const yamlStr = content.slice(3, endMatch.index + 3);
  if (!yamlStr.includes('name:')) {
    return { valid: false, error: "Frontmatter must include 'name' field." };
  }
  if (!yamlStr.includes('description:')) {
    return { valid: false, error: "Frontmatter must include 'description' field." };
  }
  const body = content.slice(endMatch.end() + 3).trim();
  if (!body) {
    return { valid: false, error: 'SKILL.md must have content after the frontmatter.' };
  }
  return { valid: true };
}

/**
 * Edit (full replace) a skill's SKILL.md content.
 * @param {string} name
 * @param {string} newContent
 * @returns {{success: boolean, message: string, error?: string}}
 */
async function editSkill(name, newContent) {
  const fs = await import('fs');
  const path = await import('path');
  const skillsDir = getOpenClawSkillsPath();

  const validation = validateFrontmatterForEdit(newContent);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const found = await findSkillByName(name, skillsDir);
  if (!found) {
    return { success: false, error: `Skill '${name}' not found. Use scanSkills() to see available skills.` };
  }

  const { path: skillMdPath } = found;
  const dir = path.dirname(skillMdPath);
  const tempPath = path.join(dir, `.SKILL.md.tmp.${Date.now()}`);

  try {
    fs.writeFileSync(tempPath, newContent, 'utf-8');
    fs.renameSync(tempPath, skillMdPath);
  } catch (e) {
    return { success: false, error: `Failed to write skill file: ${e.message}` };
  }

  return { success: true, message: `Skill '${name}' updated.` };
}

/**
 * Patch (局部替换) a skill's SKILL.md content.
 * @param {string} name
 * @param {string} oldString
 * @param {string} newString
 * @returns {{success: boolean, message: string, error?: string}}
 */
async function patchSkill(name, oldString, newString) {
  const fs = await import('fs');
  const path = await import('path');
  const skillsDir = getOpenClawSkillsPath();

  if (!oldString) {
    return { success: false, error: "old_string is required for 'patch'." };
  }
  if (newString === undefined || newString === null) {
    return { success: false, error: "new_string is required for 'patch'. Use empty string to delete matched text." };
  }

  const found = await findSkillByName(name, skillsDir);
  if (!found) {
    return { success: false, error: `Skill '${name}' not found.` };
  }

  const { path: skillMdPath } = found;
  let content;
  try {
    content = fs.readFileSync(skillMdPath, 'utf-8');
  } catch (e) {
    return { success: false, error: `Failed to read skill file: ${e.message}` };
  }

  if (!content.includes(oldString)) {
    return { success: false, error: `old_string not found in skill '${name}'. Check for exact whitespace and indentation.` };
  }

  const newContent = content.replace(oldString, newString);
  const validation = validateFrontmatterForEdit(newContent);
  if (!validation.valid) {
    return { success: false, error: `Patch would break SKILL.md structure: ${validation.error}` };
  }

  const dir = path.dirname(skillMdPath);
  const tempPath = path.join(dir, `.SKILL.md.tmp.${Date.now()}`);

  try {
    fs.writeFileSync(tempPath, newContent, 'utf-8');
    fs.renameSync(tempPath, skillMdPath);
  } catch (e) {
    return { success: false, error: `Failed to write skill file: ${e.message}` };
  }

  return { success: true, message: `Skill '${name}' patched.` };
}

// ---------------------------------------------------------------------------
// Phase 3: Session End Analysis
// ---------------------------------------------------------------------------

const { parseSessionJsonl, analyzeConversationPatterns, generateSkillMarkdown } = require('./lib/skill-generator');

// ---------------------------------------------------------------------------
// Plugin Definition
// ---------------------------------------------------------------------------

/** @type {import('openclaw').OpenClawPlugin} */
const plugin = {
  id: 'skill-wall',
  name: 'Skill Wall',
  description:
    'Aligns OpenClaw with Hermes Agent self-evolving skill system — Skill System Prompt + skill_editor tool + session analysis.',

  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },

  register(api) {
    // -----------------------------------------------------------------------
    // before_prompt_build: Inject Skill System Prompt
    // -----------------------------------------------------------------------

    api.on('before_prompt_build', async (_event, _ctx) => {
      try {
        const prompt = buildSkillSystemPrompt();
        console.error('[skill-wall] before_prompt_build: returning prependSystemContext, len=' + prompt.length);
        return { prependSystemContext: prompt };
      } catch (e) {
        // Graceful failure — don't break the prompt build
        console.error('[skill-wall] before_prompt_build error:', e.message);
      }
    });

    // -----------------------------------------------------------------------
    // session_end: Analyze conversation and generate skill drafts
    // -----------------------------------------------------------------------

    api.on('session_end', async (event) => {
      console.error('[skill-wall] session_end hook triggered');

      // sessionFile is provided directly in the event payload by OpenClaw
      const sessionFilePath = event?.sessionFile;
      if (!sessionFilePath) {
        console.error('[skill-wall] No sessionFile in event payload');
        return;
      }

      const fs$ = await import('fs');
      const path$ = await import('path');

      let sessionContent = null;
      try {
        if (fs$.existsSync(sessionFilePath)) {
          sessionContent = fs$.readFileSync(sessionFilePath, 'utf-8');
        }
      } catch (e) {
        console.error(`[skill-wall] Failed to read session file ${sessionFilePath}: ${e.message}`);
        return;
      }

      if (!sessionContent) {
        console.error(`[skill-wall] Session file is empty or not found: ${sessionFilePath}`);
        return;
      }

      console.error(`[skill-wall] Read session file: ${sessionFilePath}, size=${sessionContent.length}`);

      const messages = parseSessionJsonl(sessionContent);
      if (messages.length === 0) {
        console.error('[skill-wall] No messages found in session');
        return;
      }

      console.error(`[skill-wall] Found ${messages.length} messages, analyzing patterns...`);

      const patterns = analyzeConversationPatterns(messages);
      if (patterns.length === 0) {
        console.error('[skill-wall] No patterns worth documenting found, skipping skill generation');
        return;
      }

      console.error(`[skill-wall] Found ${patterns.length} patterns worth documenting`);

      const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
      const pluginDir = path$.join(homeDir, '.openclaw', 'extensions', 'skill-wall');
      const outputDir = path$.join(pluginDir, 'generated-skills');

      try {
        if (!fs$.existsSync(outputDir)) {
          fs$.mkdirSync(outputDir, { recursive: true });
        }
      } catch (e) {
        console.error(`[skill-wall] Failed to create output dir: ${e.message}`);
        return;
      }

      for (const pattern of patterns) {
        const filename = `skill-${Date.now()}-${pattern.type}.md`;
        const filepath = path$.join(outputDir, filename);
        const skillContent = generateSkillMarkdown(pattern);
        try {
          fs$.writeFileSync(filepath, skillContent, 'utf-8');
          console.error(`[skill-wall] Generated skill: ${filepath}`);
        } catch (e) {
          console.error(`[skill-wall] Failed to write skill: ${e.message}`);
        }
      }
    });

    // -----------------------------------------------------------------------
    // skill_editor tool: Let Agent edit/patch skills
    // -----------------------------------------------------------------------

    api.registerTool({
      name: 'skill_editor',
      description:
        'Edit or patch existing skills in ~/.openclaw/workspace/skills/. ' +
        "Use action='patch' for targeted find-and-replace (preferred). " +
        "Use action='edit' for full SKILL.md rewrite. " +
        'Skills are procedural memory — reusable approaches for recurring task types.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['edit', 'patch'],
            description: "Action: 'patch' (find-and-replace) or 'edit' (full rewrite).",
          },
          name: {
            type: 'string',
            description: 'Skill name to edit or patch.',
          },
          content: {
            type: 'string',
            description:
              "Full SKILL.md content (YAML frontmatter + markdown body). Required for action='edit'.",
          },
          old_string: {
            type: 'string',
            description:
              "Text to find in SKILL.md. Required for action='patch'. Must match exactly (including whitespace).",
          },
          new_string: {
            type: 'string',
            description:
              "Replacement text. Required for action='patch'. Use empty string to delete matched text.",
          },
        },
        required: ['action', 'name'],
      },
      async execute(_toolCallId, params) {
        const { action, name, content, old_string, new_string } = params;

        if (action === 'edit') {
          if (!content) {
            return formatToolError(
              "content is required for action='edit'. Provide the full updated SKILL.md text."
            );
          }
          const result = await editSkill(name, content);
          if (result.success) {
            return formatToolResult(result.message);
          }
          return formatToolError(result.error);
        }

        if (action === 'patch') {
          if (!old_string) {
            return formatToolError(
              "old_string is required for action='patch'. Provide the text to find."
            );
          }
          const result = await patchSkill(name, old_string, new_string);
          if (result.success) {
            return formatToolResult(result.message);
          }
          return formatToolError(result.error);
        }

        return formatToolError(`Unknown action '${action}'. Use 'patch' or 'edit'.`);
      },
    });
  },
};

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function formatToolResult(message) {
  return { content: [{ type: 'text', text: message }] };
}

function formatToolError(error) {
  return { content: [{ type: 'text', text: `Error: ${error}` }] };
}

// ---------------------------------------------------------------------------
// Exports (for testing)
// ---------------------------------------------------------------------------

module.exports = plugin;
module.exports.injectSkillSystemPrompt = buildSkillSystemPrompt;
module.exports.getOpenClawSkillsPath = getOpenClawSkillsPath;
module.exports.findSkillByName = findSkillByName;
module.exports.editSkill = editSkill;
module.exports.patchSkill = patchSkill;
module.exports.validateFrontmatterForEdit = validateFrontmatterForEdit;
