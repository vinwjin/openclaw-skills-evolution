/**
 * skill-loader.js
 * Scans workspace/skills for SKILL.md files and loads all skills
 */

const fs = require('fs');
const path = require('path');

class SkillLoader {
  constructor() {
    this.loaded = [];
  }

  /**
   * 扫描并加载所有 skills
   * @param {string} workspace - 根目录（~/.openclaw/workspace）
   * @returns {Array} [{ name, path, content, frontmatter }]
   */
  async loadAll(workspace) {
    this.loaded = [];
    const skillsRoot = path.join(workspace, 'skills');

    if (!fs.existsSync(skillsRoot)) {
      return [];
    }

    const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = path.join(skillsRoot, entry.name);
      const skillPath = path.join(skillDir, 'SKILL.md');

      if (!fs.existsSync(skillPath)) continue;

      try {
        const content = fs.readFileSync(skillPath, 'utf-8');
        const frontmatter = parseFrontmatter(content);
        const name = frontmatter.name || entry.name;

        this.loaded.push({
          name,
          path: skillPath,
          content,
          frontmatter
        });
      } catch (e) {
        // 跳过无效文件
        console.error(`[skill-loader] failed to load ${skillPath}: ${e.message}`);
      }
    }

    return this.loaded;
  }

  /**
   * 返回已加载的 skills
   */
  getLoaded() {
    return this.loaded;
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * 解析 YAML frontmatter
 * @param {string} content - 完整文件内容
 * @returns {object} frontmatter 字段
 */
function parseFrontmatter(content) {
  const fm = {};

  if (!content.startsWith('---')) return fm;

  const endMatch = content.match(/\n---\s*\n/);
  if (!endMatch) return fm;

  const yamlStr = content.slice(3, endMatch.index);

  for (const line of yamlStr.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (key === 'triggers' || key === 'tags') {
      // 多行列表
      fm[key] = value ? [value] : [];
    } else {
      fm[key] = value;
    }
  }

  return fm;
}

module.exports = { SkillLoader };
