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

      // Phase 2 implementation placeholder
      // Will analyze session JSONL and generate new skills
    });
  },
};

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Extract task description from event.
 * @param {object} event
 * @returns {string|null}
 */
function extractTaskFromEvent(event) {
  // Try to extract from various event properties
  const task =
    event?.context?.task ||
    event?.context?.currentTask ||
    event?.task ||
    event?.prompt ||
    '';

  return typeof task === 'string' ? task : null;
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

  // Inject into event.bootstrapFiles if available (OpenClaw mechanism)
  if (event?.bootstrapFiles && Array.isArray(event.bootstrapFiles)) {
    event.bootstrapFiles.push({
      type: 'text/markdown',
      content: `# Available Skills\n\n${formattedSkills}`,
      priority: 'low',
    });
  }

  // Alternative: inject into context.system or similar
  if (event?.context) {
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
