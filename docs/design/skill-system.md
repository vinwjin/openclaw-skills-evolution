# Skill 系统设计

---

## 一、自进化闭环

```
任务成功 → agent 调用 skill_manage tool → 创建/更新 SKILL.md
→ 下次同类任务 → scan_skill_commands() 扫描
→ 注入为 user message → agent 看到 skill 内容 → 按固化流程执行
```

### Hermes 的 skill 加载流程

1. **启动时**: `prompt_builder.build_skills_system_prompt()` 扫描 `~/.hermes/skills/`
2. **生成 index**: 构建 skills 列表，格式化为 system prompt 的一部分
3. **Agent 指令**: "Before replying, scan the skills below. If a skill matches, you MUST load it with skill_view(name)"
4. **加载 skill**: agent 调用 `skill_view(name)` 加载完整 skill 内容
5. **Skill 注入方式**: skill 内容作为 **user message** 注入（保护 prompt caching）

---

## 二、OpenClaw 移植对照

| Hermes | OpenClaw | 复刻方案 |
|--------|----------|----------|
| skill_manage tool | ❌ 无 | Phase 3 实现 |
| scan_skill_commands | ❌ 无 | plugin 扫描 |
| prompt_builder index | ❌ 无 | plugin 注入 |
| bootstrapFiles 注入 | ⚠️ 部分支持 | Task 1.5 验证 |
| bootstrap-extra-files | ✅ 已有（内置 hook） | 可直接利用 |
| skills_guard | ❌ 无 | Phase 3 实现或复用 Python |
| SKILL.md 格式 | ✅ 兼容 | 直接复用 |

---

## 三、关键发现

### 1. bootstrap-extra-files 已内置

OpenClaw 的 `openclaw.json` 中已配置：

```json
"hooks": {
  "internal": {
    "entries": {
      "bootstrap-extra-files": {
        "enabled": true,
        "paths": ["MEMORY.md", "IDENTITY.md", "SOUL.md", "USER.md"]
      }
    }
  }
}
```

这是 OpenClaw **内置**的 internal hook，支持把指定文件在 session 启动时注入为 bootstrap context。

**用途**: plugin 可以通过扩展此 hook 或直接利用现有机制注入 skill 文件。

### 2. OpenClaw 已有 skill 生态

```
/home/king/.npm-global/lib/node_modules/openclaw/skills/
├── github/SKILL.md
├── obsidian/SKILL.md
├── notion/SKILL.md
├── slack/SKILL.md
└── ... (共 20+ 个内置 skill)
```

OpenClaw 自己的 skill 格式与 Hermes 基本兼容，且有 `~/.openclaw/skills/` 本地 skill 目录。

### 3. 核心未知：before_prompt_build hook

当前 `handler.js` 使用了 `api.on('before_prompt_build', ...)`，但：
- OpenClaw 内置 hook 列表中没有 `before_prompt_build`
- 内置的是 `bootstrap-extra-files`, `session-memory`, `command-logger` 等
- `agent:bootstrap` 是 OpenClaw 生命周期中的事件，但 `event.context` 里是否有当前任务描述**尚未验证**

**这是 Task 1.5 的核心验证点**。

---

## 四、正确 Plugin 格式

```javascript
// ✅ 正确
module.exports = {
  id: 'skill-wall',
  register(api) {
    api.on('hook_name', handler);
    api.registerTool({ name: '...', schema: {...}, async execute() {} });
  }
};
```

```javascript
// ❌ 错误（早期文档）
module.exports = {
  id: 'skill-wall',
  hooks: { 'hook_name': handler }  // 不支持这种格式
};
```

---

## 五、SKILL.md 格式

### Hermes 格式

```yaml
---
name: github-pr-workflow
description: 完整的 pull request 生命周期
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [GitHub, Pull-Requests, CI/CD]
    related_skills: [github-auth, github-code-review]
---

# GitHub Pull Request Workflow

## 1. Branch Creation
...
```

### OpenClaw 格式（扩展字段）

OpenClaw 的 skill 格式兼容 Hermes，并在 `metadata` 下增加了 `openclaw` 扩展：

```yaml
---
name: obsidian
description: Work with Obsidian vaults
metadata:
  openclaw:
    emoji: "💎"
    requires:
      bins: ["obsidian-cli"]
    install:
      - id: brew
        kind: brew
        formula: "yakitrak/yakitrak/obsidian-cli"
---

# Obsidian
...
```

**结论**: 两套格式兼容。OpenClaw 扫描 Hermes skill 时，`metadata.hermes` 和 `metadata.openclaw` 字段均会被读取，只需处理 `metadata.openclaw` 中的额外子字段。

### Frontmatter 字段对照

| 字段 | Hermes | OpenClaw | 说明 |
|------|--------|----------|------|
| name | ✅ | ✅ | Skill 唯一名称 |
| description | ✅ | ✅ | 简短描述 |
| version | ✅ | ✅ | 版本号 |
| author | ✅ | ❌ | 作者 |
| license | ✅ | ❌ | 许可证 |
| metadata.hermes.tags | ✅ | ✅ | 标签列表 |
| metadata.hermes.related_skills | ✅ | ✅ | 相关 skills |
| metadata.openclaw.* | ❌ | ✅ | OpenClaw 特有扩展 |