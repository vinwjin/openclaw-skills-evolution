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

  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatterMatch) return fm;

  const lines = frontmatterMatch[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (key === 'triggers' || key === 'tags') {
      const items = [];

      if (value.startsWith('[') && value.endsWith(']')) {
        items.push(...parseInlineList(value));
      } else if (value) {
        items.push(parseScalar(value));
      }

      for (let j = i + 1; j < lines.length; j++) {
        const nestedLine = lines[j];
        const nestedMatch = nestedLine.match(/^(\s*)-\s*(.+)\s*$/);
        if (!nestedMatch) break;
        const itemIndent = nestedMatch[1].length;
        if (items.length === 0) {
          // First list item: capture and record its indent level
          items.push(parseScalar(nestedMatch[2]));
          var listIndent = itemIndent;
        } else if (itemIndent > listIndent) {
          // Deeper indent: sub-list. Skip ALL deeply-nested items (indent > listIndent),
          // then look for the next top-level item at exactly listIndent.
          let foundNext = false;
          for (let k = j + 1; k < lines.length; k++) {
            const rest = lines[k];
            const restMatch = rest.match(/^(\s*)-\s*(.+)\s*$/);
            if (!restMatch) { k = lines.length; break; }
            const restIndent = restMatch[1].length;
            if (restIndent === listIndent) {
              // Next top-level item at listIndent found
              items.push(parseScalar(restMatch[2]));
              j = k;       // advance outer j to this item
              foundNext = true;
              break;
            }
            // else: deeper or shallower → keep scanning
          }
          if (!foundNext) { j = lines.length; break; }
        } else {
          // Same indent as first item: top-level list item
          items.push(parseScalar(nestedMatch[2]));
        }
        i = j;
      }

      fm[key] = items;
      continue;
    }

    fm[key] = parseScalar(value);
  }

  return fm;
}

function parseInlineList(value) {
  return value
    .slice(1, -1)
    .split(',')
    .map(item => parseScalar(item.trim()))
    .filter(Boolean);
}

function parseScalar(value) {
  if (!value) return '';
  return value.replace(/^['"]|['"]$/g, '');
}

module.exports = { SkillLoader };
