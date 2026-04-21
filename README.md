# OpenClaw Skills Evolution

对标 Hermes Skills 自我进化机制，让 OpenClaw Agent 在任务中主动沉淀经验为可复用 SKILL.md。

## 核心功能

OpenClaw Agent 在完成任务过程中，主动发现值得固化的经验 → 调用 `skill_manage` 沉淀为 SKILL.md。下次遇到同类问题时自动检索调用。

## 三个工具

| 工具 | 说明 |
|------|------|
| `skill_manage` | 创建 / 编辑 / 补丁 / 删除 SKILL.md |
| `skill_list` | 列出所有 Skills |
| `skill_search` | 关键词搜索 Skills |

## SKILL.md 格式

```yaml
---
name: example-skill
description: 这是一个示例 Skill
triggers:
  - 当做某事时
tags:
  - 标签1
version: 1.0.0
---

# 内容
正文...
```

## 安装

```bash
# 复制插件到扩展目录
cp -r plugin ~/.openclaw/extensions/skills-evolution

# 确保 openclaw.json 已配置（plugins.entries 和 plugins.allow）
# 重启 Gateway
openclaw gateway restart
```

## 文件结构

```
plugin/
├── index.js                # 主入口（注册三个工具）
├── openclaw.plugin.json    # 插件清单
└── package.json            # 含 openclaw.extensions

lib/
├── skill-loader.js         # 扫描 ~/.openclaw/workspace/skills/*/SKILL.md
├── skill-saver.js          # 写入 SKILL.md
└── skill-index.js          # 关键词索引 + TF-IDF 搜索
```

## 版本

v0.3.0 — 精简为纯工具模式，无自动沉淀，经验固化全靠 Agent 主动判断。
