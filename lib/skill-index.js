/**
 * skill-index.js
 * 简单的关键词索引 + TF-IDF 评分搜索
 */

class SkillIndex {
  constructor() {
    this.skills = []; // { name, description, triggers, actions, content }
    this.docCount = 0;
  }

  /**
   * 添加一个 skill 到索引
   * @param {object} skill - { name, description, triggers, actions, content }
   */
  add(skill) {
    const doc = {
      name: skill.name || '',
      description: skill.description || '',
      triggers: Array.isArray(skill.triggers) ? skill.triggers : [],
      actions: Array.isArray(skill.actions) ? skill.actions : [],
      content: skill.content || ''
    };
    this.docCount++;
    this.skills.push(doc);
  }

  /**
   * 搜索
   * @param {string} query - 关键词
   * @returns {Array} [{ name, score, description }]
   */
  search(query) {
    if (!query || !query.trim()) return [];
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const results = [];

    for (const skill of this.skills) {
      let score = 0;
      const texts = [
        skill.name,
        skill.description,
        ...skill.triggers,
        ...skill.actions,
        skill.content || ''
      ].join(' ');

      for (const term of terms) {
        score += countMatch(texts, term);
      }

      if (score > 0) {
        results.push({
          name: skill.name,
          score,
          description: skill.description
        });
      }
    }

    // 按 score 降序
    results.sort((a, b) => b.score - a.score);
    return results;
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * 简单分词：提取 Unicode 字母/数字组合，转小写
 */
function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

/**
 * 计算 term 在 text 中出现的次数
 */
function countMatch(text, term) {
  if (!text || !term) return 0;
  const lower = text.toLowerCase();
  const termLower = term.toLowerCase();
  let count = 0;
  let pos = 0;
  while ((pos = lower.indexOf(termLower, pos)) !== -1) {
    count++;
    pos += termLower.length;
  }
  return count;
}

module.exports = { SkillIndex };
