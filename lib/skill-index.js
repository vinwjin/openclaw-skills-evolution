/**
 * skill-index.js
 * 简单的关键词索引 + TF-IDF 评分搜索
 */

const TOKEN_ALIAS_GROUPS = [
  ['agent', '代理'],
  ['backup', '备份'],
  ['browser', '浏览器'],
  ['click', '点击'],
  ['database', '数据库'],
  ['deploy', '部署'],
  ['deterministic', '稳定'],
  ['edge', 'msedge'],
  ['element', '元素'],
  ['fill', '填写'],
  ['fix', '修复'],
  ['form', '表单'],
  ['page', '页面'],
  ['playwright', '浏览器自动化'],
  ['production', '生产'],
  ['project', '项目'],
  ['restore', '恢复'],
  ['screenshot', '截图'],
  ['select', '选择'],
  ['snapshot', '快照'],
  ['stable', '稳定'],
  ['workflow', '流程'],
  ['automation', '自动化']
];

const PHRASE_EXPANSIONS = [
  ['浏览器自动化', '浏览器 自动化 browser automation playwright'],
  ['表单填写', '表单 填写 form fill'],
  ['元素选择', '元素 选择 element select'],
  ['稳定元素选择', '稳定 元素 选择 deterministic stable element select'],
  ['数据库备份', '数据库 备份 database backup'],
  ['恢复备份', '恢复 备份 restore backup'],
  ['控制edge', '控制 edge browser'],
  ['控制 Edge', '控制 edge browser']
];

const TOKEN_ALIASES = buildTokenAliases(TOKEN_ALIAS_GROUPS);

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
    // 限制查询 token 数量，避免超长输入导致分词和评分成本失控。
    if (String(query).length > 10000) return [];
    const terms = tokenize(query);
    if (terms.length > 200) return [];
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
  const normalizedText = normalizeSearchText(text);
  const baseTokens = normalizedText.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const expanded = [];
  for (const token of baseTokens) {
    expanded.push(token);
    const aliases = TOKEN_ALIASES.get(token);
    if (aliases) {
      expanded.push(...aliases);
    }
  }
  return expanded;
}

/**
 * 计算 term 在 text 中出现的次数
 */
function countMatch(text, term) {
  if (!text || !term) return 0;
  const termLower = term.toLowerCase();
  return tokenize(text).filter(token => token === termLower).length;
}

function buildTokenAliases(groups) {
  const map = new Map();
  for (const group of groups) {
    for (const token of group) {
      const key = String(token).toLowerCase();
      const aliases = group
        .map(item => String(item).toLowerCase())
        .filter(item => item !== key);
      map.set(key, aliases);
    }
  }
  return map;
}

function normalizeSearchText(text) {
  let normalized = String(text || '');
  for (const [needle, replacement] of PHRASE_EXPANSIONS) {
    normalized = normalized.split(needle).join(`${needle} ${replacement}`);
  }
  return normalized;
}

module.exports = { SkillIndex, tokenize };
