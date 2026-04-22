/**
 * skill-saver.js
 * 写入 SKILL.md 到 workspace/skills/{safeName}/SKILL.md
 */

const path = require('path');
const fs = require('fs');

class SkillSaver {
  /**
   * 保存/更新一个 skill
   * @param {string} workspace - 根目录（~/.openclaw/workspace）
   * @param {object} data - { name, content }
   */
  async save(workspace, data) {
    const { name, content } = data;

    if (!content || !content.trim()) {
      throw new Error('content is required');
    }

    // 验证 frontmatter
    this.validate(content);

    const safeName = toSafeName(name);
    const skillDir = path.join(workspace, 'skills', safeName);
    const filePath = path.join(skillDir, 'SKILL.md');

    // 确保目录存在
    await fs.promises.mkdir(skillDir, { recursive: true });

    // 写入文件
    await fs.promises.writeFile(filePath, content, 'utf-8');

    return { safeName, skillDir, filePath };
  }

  /**
   * 验证 frontmatter 格式
   * @param {string} content
   */
  validate(content) {
    if (!content.startsWith('---')) {
      throw new Error('SKILL.md must start with YAML frontmatter (---)');
    }

    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!frontmatterMatch) {
      throw new Error('Frontmatter not closed. Add closing --- line.');
    }

    const yamlStr = frontmatterMatch[1];
    if (!yamlStr.includes('name:')) {
      throw new Error("Frontmatter must include 'name' field");
    }

    return true;
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * 将 name 转为安全的目录名
 * "My Skill 123!" → "my-skill-123"
 */
function toSafeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { SkillSaver };
