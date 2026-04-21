# OpenClaw Skills Evolution — CLAUDE.md

## 项目概述
**目标**：对标 Hermes Skills 自我进化机制，让 OpenClaw Agent 在任务中主动发现值得固化的经验 → 调用 skill_manage 沉淀为 SKILL.md。

**v0.3 设计**：精简插件，只注册三个工具，不做自动分析。
- `skill_manage`：创建/编辑/补丁/删除 SKILL.md
- `skill_list`：列出所有 Skills
- `skill_search`：关键词搜索 Skills

**无 Hook，无 MiniMax，无自动沉淀。** 纯工具模式，经验沉淀全靠 Agent 主动判断。

---

## 技术规格

### Skills 存储路径
```
~/.openclaw/workspace/skills/{safeName}/SKILL.md
```
- `safeName`：将 Skill name 转为安全的目录名（小写、连字符、移除特殊字符）
- 示例：`My Skill 123` → `my-skill-123`

### SKILL.md 格式（YAML frontmatter + Markdown）
```yaml
---
name: example-skill
description: 这是一个示例 Skill
triggers:
  - 当做某事时
tags:
  - 标签1
  - 标签2
version: 1.0.0
author: openclaw
---

# Skill 内容
正文...
```

### skill_manage 参数
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| action | string | 是 | create / edit / patch / delete |
| name | string | 是 | Skill 名称 |
| content | string | create/edit 必填 | 完整 SKILL.md 内容（含 frontmatter） |
| old_string | string | patch 必填 | 要替换的文本 |
| new_string | string | patch 选填 | 替换文本，空=删除 |

### safeName 规则
```js
function toSafeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```
- 全小写
- 空格/特殊字符 → 连字符
- 连续连字符压缩为一个
- 前后连字符去除

---

## 文件结构
```
openclaw-skills-evolution/
├── CLAUDE.md
├── README.md
├── _meta.json                  # version: 0.3.0
├── plugin/
│   ├── index.js                # 主入口（注册三个工具）
│   ├── openclaw.plugin.json    # { id, name, configSchema }
│   └── package.json            # { openclaw: { extensions: ["./index.js"] } }
└── lib/
    ├── skill-loader.js         # 扫描 workspace/skills/*/SKILL.md
    ├── skill-saver.js          # 写入 SKILL.md 到 safeName 目录
    └── skill-index.js          # 关键词索引 + TF-IDF 搜索
```

---

## 状态

| 组件 | 状态 |
|------|------|
| `plugin/index.js` | ✅ 完成 |
| `plugin/openclaw.plugin.json` | ✅ 完成 |
| `plugin/package.json` | ✅ 完成 |
| `lib/skill-loader.js` | ✅ 完成 |
| `lib/skill-saver.js` | ✅ 完成 |
| `lib/skill-index.js` | ✅ 完成 |
| README.md | ✅ 完成 |
| 源文件 → 安装目录同步 | ✅ 完成 |
| openclaw.json 配置 | ✅ 完成 |
| Gateway 插件加载 | ✅ v0.3.0 loaded |
| 实际验证（自发沉淀测试） | ✅ 通过（windows-path + wsl-windows-path） |

---

## 已验证功能

### 测试 1：提示创建
- 任务：提示"整理 Windows 路径规则并沉淀为 Skill"
- 结果：✅ windows-path Skill 创建成功

### 测试 2：自发沉淀（无提示）
- 任务：调研 WSL PATH 冲突问题，**不提示沉淀**
- 结果：✅ Agent 自发创建 wsl-windows-path Skill
- 验证：两个 Skill 均含正确 frontmatter + 正文内容
