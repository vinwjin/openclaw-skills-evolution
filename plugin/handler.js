/**
 * OpenClaw Skill Wall Plugin
 *
 * Replicates Hermes Agent's self-evolving skill system on OpenClaw.
 * Scans ~/.hermes/skills/, matches tasks, and injects relevant skills into prompts.
 */

// ---------------------------------------------------------------------------
// Core Modules
// ---------------------------------------------------------------------------

/**
 * Recursively scan skillsDir for all SKILL.md files.
 * @param {string} skillsDir - Root skills directory (e.g., ~/.hermes/skills/)
 * @returns {Promise<Array>} Array of skill objects
 */
async function scanSkills(skillsDir) {
  const fs = await import('fs');
  const path = await import('path');

  /** @type {Array} */
  const skills = [];

  /**
   * @param {string} dir
   */
  async function scanDir(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // Directory doesn't exist or no access
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath); // Recurse into subdirectories
      } else if (entry.name === 'SKILL.md') {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const parsed = parseFrontmatter(content);
          if (parsed.frontmatter && parsed.frontmatter.name) {
            const relPath = path.relative(skillsDir, fullPath);
            const parts = relPath.split(path.sep);
            const category = parts.length > 1 ? parts[0] : 'uncategorized';
            skills.push({
              name: parsed.frontmatter.name,
              description: parsed.frontmatter.description || '',
              tags: parsed.frontmatter.metadata?.hermes?.tags || [],
              category,
              path: fullPath,
              content: parsed.body,
            });
          }
        } catch {
          // Skip files that can't be read
        }
      }
    }
  }

  await scanDir(skillsDir);
  return skills;
}

/**
 * Parse YAML frontmatter from markdown content.
 * @param {string} content - Full file content
 * @returns {{frontmatter: object, body: string}}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  // Simple YAML parsing for frontmatter
  const yamlStr = match[1];
  const body = match[2];
  const frontmatter = {};

  for (const line of yamlStr.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (key === 'metadata') {
      // Skip metadata parsing for now - could be extended
      continue;
    }

    if (value === '' || value === null) {
      // Empty value
      frontmatter[key] = null;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      // Array: [item1, item2]
      frontmatter[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim());
    } else {
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

/**
 * Match skills to current task using weighted keyword matching.
 * @param {string} task - Current task description
 * @param {Array} skills - Array of skill objects
 * @returns {Array} Sorted matched skills by score descending
 */
function matchSkills(task, skills) {
  const taskLower = task.toLowerCase();
  const taskWords = taskLower.split(/\s+/).filter((w) => w.length > 2);

  /** @type {Array} */
  const scored = skills.map((skill) => {
    let score = 0;

    // name match × 3
    const nameLower = (skill.name || '').toLowerCase();
    for (const word of taskWords) {
      if (nameLower.includes(word)) score += 3;
    }

    // description match × 1
    const descLower = (skill.description || '').toLowerCase();
    for (const word of taskWords) {
      if (descLower.includes(word)) score += 1;
    }

    // tags match × 2
    for (const tag of skill.tags || []) {
      const tagLower = tag.toLowerCase();
      for (const word of taskWords) {
        if (tagLower.includes(word)) score += 2;
      }
    }

    return { skill, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.skill);
}

/**
 * Get the Hermes skills directory path.
 * @returns {string}
 */
function getHermesSkillsPath() {
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  return `${home}/.hermes/skills/`;
}

// ---------------------------------------------------------------------------
// Dependencies
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
    'OpenClaw plugin that replicates Hermes Agent\'s self-evolving skill system — scans ~/.hermes/skills/, matches tasks, and injects relevant skills into prompts.',

  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        default: true,
        description: 'Enable or disable skill injection',
      },
      skillsDir: {
        type: 'string',
        default: null, // null = auto-detect
        description: 'Custom Hermes skills directory path',
      },
      maxSkills: {
        type: 'integer',
        default: 5,
        minimum: 1,
        maximum: 20,
        description: 'Maximum number of skills to inject per session',
      },
      matchThreshold: {
        type: 'integer',
        default: 2,
        minimum: 1,
        description: 'Minimum score threshold for skill injection',
      },
    },
  },

  register(api) {
    // -----------------------------------------------------------------------
    // Task 1.5: Implement bootstrap injection via before_prompt_build hook
    // -----------------------------------------------------------------------

    api.on('before_prompt_build', async (event) => {
      // Skip if disabled
      const config = api.getConfig();
      if (!config.enabled) return;

      const skillsDir = config.skillsDir || getHermesSkillsPath();
      const maxSkills = config.maxSkills || 5;
      const threshold = config.matchThreshold || 2;

      // Extract task description from event
      const task = extractTaskFromEvent(event);
      if (!task) return;

      // Scan and match skills
      let skills;
      try {
        skills = await scanSkills(skillsDir);
      } catch {
        return; // Failed to scan - graceful failure
      }

      const matched = matchSkills(task, skills).slice(0, maxSkills);
      if (matched.length === 0) return;

      // Filter by threshold
      const thresholdFiltered = matched.filter((s) => {
        const score = calculateScore(task, s);
        return score >= threshold;
      });
      if (thresholdFiltered.length === 0) return;

      // Inject skills into prompt
      injectSkillsIntoEvent(event, thresholdFiltered);
    });

    // -----------------------------------------------------------------------
    // Phase 2: Session end analysis (session_end hook)
    // -----------------------------------------------------------------------

    api.on('session_end', async (event) => {
      const config = api.getConfig();
      if (!config.enabled) return;

      console.error('[skill-wall] session_end hook triggered');

      // Step 1: Get session ID from event
      const sessionId = event?.sessionId || event?.sessionKey || event?.session_id;
      if (!sessionId) {
        console.error('[skill-wall] No sessionId found in event');
        return;
      }
      console.error(`[skill-wall] Analyzing session: ${sessionId}`);

      // Step 2: Read session JSONL file from ~/.openclaw/sessions/
      const fs = await import('fs');
      const path = await import('path');
      const home = process.env.HOME || process.env.USERPROFILE || '~';
      const sessionsDir = path.join(home, '.openclaw', 'sessions');

      // Try different session file patterns
      const sessionFilePatterns = [
        path.join(sessionsDir, `${sessionId}.jsonl`),
        path.join(sessionsDir, sessionId),
        path.join(sessionsDir, `${sessionId}.json`)
      ];

      let sessionContent = null;
      let sessionFilePath = null;

      for (const pattern of sessionFilePatterns) {
        try {
          if (fs.existsSync(pattern)) {
            sessionContent = fs.readFileSync(pattern, 'utf-8');
            sessionFilePath = pattern;
            break;
          }
        } catch (e) {
          // Try next pattern
        }
      }

      if (!sessionContent) {
        // Try to find session file by matching partial sessionId
        try {
          const files = fs.readdirSync(sessionsDir);
          const matchingFile = files.find(f => f.includes(sessionId) || sessionId.includes(f.replace('.jsonl', '')));
          if (matchingFile) {
            sessionFilePath = path.join(sessionsDir, matchingFile);
            sessionContent = fs.readFileSync(sessionFilePath, 'utf-8');
          }
        } catch (e) {
          // Sessions dir not accessible
        }
      }

      if (!sessionContent) {
        console.error(`[skill-wall] Session file not found for: ${sessionId}`);
        return;
      }

      console.error(`[skill-wall] Read session file: ${sessionFilePath}`);

      // Step 3: Parse JSONL and analyze conversation
      const messages = parseSessionJsonl(sessionContent);
      if (messages.length === 0) {
        console.error('[skill-wall] No messages found in session');
        return;
      }

      console.error(`[skill-wall] Found ${messages.length} messages, analyzing patterns...`);

      // Step 4: Analyze patterns in conversation
      const patterns = analyzeConversationPatterns(messages);

      if (patterns.length === 0) {
        console.error('[skill-wall] No值得沉淀 patterns found, skipping skill generation');
        return;
      }

      console.error(`[skill-wall] Found ${patterns.length} patterns worth documenting`);

      // Step 5: Create generated-skills directory and write skill drafts
      const pluginDir = path.dirname(require.resolve('./handler.js'));
      const outputDir = path.join(pluginDir, 'generated-skills');

      try {
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
      } catch (e) {
        console.error(`[skill-wall] Failed to create output dir: ${e.message}`);
        return;
      }

      for (const pattern of patterns) {
        const filename = `skill-${Date.now()}-${pattern.type}.md`;
        const filepath = path.join(outputDir, filename);

        const skillContent = generateSkillMarkdown(pattern);
        try {
          fs.writeFileSync(filepath, skillContent, 'utf-8');
          console.error(`[skill-wall] Generated skill: ${filepath}`);
        } catch (e) {
          console.error(`[skill-wall] Failed to write skill: ${e.message}`);
        }
      }
    });
  },
};

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Extract task description from event using intelligent inference.
 * Strategy: find the longest string field that contains natural language.
 * @param {object} event
 * @returns {string|null}
 */
function extractTaskFromEvent(event) {
  /** @type {Array<{value: string, length: number}>} */
  const candidates = [];

  // Collect all string fields from event and event.context
  const searchIn = (obj, prefix = '') => {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === 'string' && val.trim().length > 0) {
        candidates.push({ value: val, length: val.length });
      } else if (typeof val === 'object' && val !== null) {
        searchIn(val, prefix + key + '.');
      }
    }
  };

  searchIn(event);
  if (event?.context) searchIn(event.context, 'context.');

  // Filter out non-natural-language strings (paths, IDs, codes, etc.)
  const filtered = candidates.filter(({ value }) => {
    const trimmed = value.trim();
    // Exclude pure paths (contain / or \)
    if (trimmed.match(/^[\/\\].*[\/\\]/)) return false;
    // Exclude pure IDs (short alphanumeric strings)
    if (trimmed.match(/^[a-zA-Z0-9_-]{1,30}$/)) return false;
    // Exclude strings with more code-like chars than letters
    const alphaCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
    const totalCount = trimmed.length;
    if (totalCount > 10 && alphaCount / totalCount < 0.5) return false;
    // Exclude very short strings
    if (trimmed.length < 20) return false;
    return true;
  });

  if (filtered.length === 0) return null;

  // Return the longest one
  filtered.sort((a, b) => b.length - a.length);
  return filtered[0].value;
}

/**
 * Calculate match score for a task and skill.
 * @param {string} task
 * @param {object} skill
 * @returns {number}
 */
function calculateScore(task, skill) {
  const taskLower = task.toLowerCase();
  const taskWords = taskLower.split(/\s+/).filter((w) => w.length > 2);
  let score = 0;

  const nameLower = (skill.name || '').toLowerCase();
  for (const word of taskWords) {
    if (nameLower.includes(word)) score += 3;
  }

  const descLower = (skill.description || '').toLowerCase();
  for (const word of taskWords) {
    if (descLower.includes(word)) score += 1;
  }

  for (const tag of skill.tags || []) {
    const tagLower = tag.toLowerCase();
    for (const word of taskWords) {
      if (tagLower.includes(word)) score += 2;
    }
  }

  return score;
}

/**
 * Inject matched skills into event.
 * @param {object} event
 * @param {Array} skills
 */
function injectSkillsIntoEvent(event, skills) {
  // Format skills for injection
  const formattedSkills = skills
    .map((skill) => {
      return `## ${skill.name}\n${skill.content}`;
    })
    .join('\n\n---\n\n');

  let injected = false;

  // Method 1: event.bootstrapFiles (OpenClaw mechanism)
  if (event?.bootstrapFiles && Array.isArray(event.bootstrapFiles)) {
    event.bootstrapFiles.push({
      type: 'text/markdown',
      content: `# Available Skills\n\n${formattedSkills}`,
      priority: 'low',
    });
    injected = true;
  }

  // Method 2: event.systemPrompt (if exists)
  if (!injected && event?.systemPrompt) {
    event.systemPrompt += `\n\n# Available Skills\n\n${formattedSkills}`;
    injected = true;
  }

  // Method 3: event.prependContext (if exists)
  if (!injected && event?.prependContext) {
    event.prependContext += `\n\n# Available Skills\n\n${formattedSkills}`;
    injected = true;
  }

  // Method 4: fallback to context.skills
  if (!injected && event?.context) {
    if (!event.context.skills) {
      event.context.skills = [];
    }
    event.context.skills.push(...skills);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = plugin;
module.exports.scanSkills = scanSkills;
module.exports.parseFrontmatter = parseFrontmatter;
module.exports.matchSkills = matchSkills;
module.exports.getHermesSkillsPath = getHermesSkillsPath;
module.exports.extractTaskFromEvent = extractTaskFromEvent;
module.exports.calculateScore = calculateScore;
module.exports.injectSkillsIntoEvent = injectSkillsIntoEvent;
module.exports.parseSessionJsonl = parseSessionJsonl;
module.exports.analyzeConversationPatterns = analyzeConversationPatterns;
module.exports.generateSkillMarkdown = generateSkillMarkdown;
