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

    const safeName = await toSafeName(workspace, name, content);
    const skillDir = path.join(workspace, 'skills', safeName);
    const filePath = path.join(skillDir, 'SKILL.md');
    const skillsRoot = path.join(workspace, 'skills');

    // 确保目录存在
    await fs.promises.mkdir(skillDir, { recursive: true });

    // 写入前拒绝符号链接并验证真实路径仍位于 skills 根目录内。
    await assertSafeSkillPath(skillsRoot, skillDir, filePath);

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
async function toSafeName(workspace, name, content) {
  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const skillDir = path.join(workspace, 'skills', safeName);
  const filePath = path.join(skillDir, 'SKILL.md');

  // 在 slug 冲突检测前先拒绝符号链接，避免读取到链接目标文件内容。
  await rejectSymlink(skillDir);
  await rejectSymlink(filePath);

  if (fs.existsSync(filePath)) {
    const existingContent = await fs.promises.readFile(filePath, 'utf-8');
    if (existingContent !== content) {
      throw new Error(`Skill slug collision for '${safeName}': existing skill content differs`);
    }
  }

  return safeName;
}

async function assertSafeSkillPath(skillsRoot, skillDir, filePath) {
  await rejectSymlink(skillDir);
  await rejectSymlink(filePath);

  const resolvedRoot = await fs.promises.realpath(skillsRoot);
  const resolvedDir = await fs.promises.realpath(skillDir);
  const resolvedFileParent = await fs.promises.realpath(path.dirname(filePath));
  const normalizedRoot = ensureTrailingSep(resolvedRoot);

  if (!resolvedDir.startsWith(normalizedRoot) || !resolvedFileParent.startsWith(normalizedRoot)) {
    throw new Error('resolved skill path escapes workspace/skills');
  }
}

async function rejectSymlink(targetPath) {
  try {
    const stat = await fs.promises.lstat(targetPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`symbolic link is not allowed: ${targetPath}`);
    }
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
}

function ensureTrailingSep(value) {
  return value.endsWith(path.sep) ? value : value + path.sep;
}

module.exports = { SkillSaver };
