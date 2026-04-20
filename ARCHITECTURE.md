# OpenClaw Skill Wall — 技术架构

---

## 一、关键架构事实

**Hermes = Python 进程，OpenClaw = Node.js 进程。两者语言栈不互通。**

这决定了项目的技术路线：
- 不能把 Python 代码直接塞进 OpenClaw
- 必须通过 OpenClaw Plugin 机制扩展
- Skill 文件存储复用 Hermes 格式（`~/.hermes/skills/`）

---

## 二、整体架构

```
OpenClaw Agent (Node.js)
    │
    ▼ before_prompt_build hook
~/.openclaw/extensions/skill-wall/
    handler.js
    │
    ▼ 扫描 ~/.hermes/skills/*.SKILL.md
    │
    ▼ 解析 YAML frontmatter
    │
    ▼ 匹配当前任务
    │
    ▼ 注入 skill 内容到 prompt/system context
```

---

## 三、OpenClaw Plugin 机制

### Plugin 结构

```
~/.openclaw/extensions/skill-wall/
├── openclaw.plugin.json     # plugin 元数据
├── package.json            # npm 包配置
└── handler.js              # 主入口
```

### openclaw.plugin.json

```json
{
  "id": "skill-wall",
  "kind": "general",
  "skills": ["skill-wall"]
}
```

### handler.js 骨架

```javascript
module.exports = {
  id: 'skill-wall',

  register(api) {
    // 注册 hook handler
    api.on('before_prompt_build', async (event) => {
      // 扫描 skills
      // 匹配任务
      // 注入 skill 内容
    });
  }
};
```

### 已验证的 hooks

| Hook | 用途 |
|------|------|
| `before_prompt_build` | Prompt 构建前修改 |
| `session_end` | 会话结束时处理 |
| `gateway_start` | 网关启动时 |
| `before_reset` | 会话重置前 |

### Plugin API

```javascript
api.on(event, handler)     // 注册 hook
api.registerTool(tool)     // 注册 tool
```

---

## 四、核心模块

### 4.1 Skill Scanner

**职责**: 递归扫描 `~/.hermes/skills/`，解析 SKILL.md

**函数**: `scanSkills(skillsDir)`

**输出**: `[{name, description, tags, category, path, content}, ...]`

### 4.2 Frontmatter Parser

**职责**: 解析 YAML frontmatter

**函数**: `parseFrontmatter(content)`

**输出**: `{frontmatter: {}, body: string}`

### 4.3 Task Matcher

**职责**: 匹配当前任务与 skills

**函数**: `matchSkills(task, skills)`

**算法**: 关键词加权匹配
- name 匹配 × 3
- description 匹配 × 1
- tags 匹配 × 2

### 4.4 Skill Injector

**职责**: 注入 skill 内容到 prompt

**函数**: `injectSkill(event, skill)`

**注入方式**（待验证）:
- 方案 A: `event.context.bootstrapFiles` 数组（OpenClaw 官方机制）
- 方案 B: 直接修改 prompt/system context
- 方案 C: 写临时文件注入

**验证任务**: Task 1.5 必须先验证 `bootstrapFiles` 是否可写

---

## 五、Skill 文件格式

复用 Hermes 标准格式：

```markdown
---
name: github-pr-workflow
description: 完整的 pull request 生命周期
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [GitHub, Pull-Requests]
    related_skills: [github-auth]
---

# GitHub Pull Request Workflow

## 1. Branch Creation
...
```

### Frontmatter 字段

| 字段 | 必填 | 说明 |
|------|------|------|
| name | ✅ | Skill 唯一名称 |
| description | ✅ | 简短描述 |
| version | ❌ | 版本号 |
| author | ❌ | 作者 |
| license | ❌ | 许可证 |
| metadata.hermes.tags | ❌ | 标签 |
| metadata.hermes.related_skills | ❌ | 相关 skills |

---

## 六、关键路径

| 路径 | 用途 |
|------|------|
| `~/.hermes/skills/` | Hermes skills（被扫描的目标） |
| `~/.openclaw/extensions/skill-wall/` | 本 plugin 安装位置 |

---

## 七、参考项目

| 项目 | 路径 | 参考内容 |
|------|------|----------|
| Hermes Agent | `~/.hermes/hermes-agent/` | skill_manager_tool.py, SKILL.md 格式 |
| lossless-claw | `~/.openclaw/extensions/lossless-claw/` | OpenClaw plugin 结构, hooks |

---

## 八、技术约束

1. **不能修改 OpenClaw 源码** — 必须通过 Plugin 机制
2. **语言隔离** — Hermes (Python) ↔ OpenClaw (Node.js)
3. **零依赖** — 仅用 Node.js 标准库
4. **兼容 Hermes** — skill 存储在 `~/.hermes/skills/`
