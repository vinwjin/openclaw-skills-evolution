# OpenClaw Skills Evolution

对标 Hermes Skills 自我进化机制，让 OpenClaw Agent 在任务中主动沉淀经验为可复用 SKILL.md。

## 双轨沉淀机制

### 轨道1：任务过程中主动沉淀
Agent 在完成任务时，主动发现值得固化的经验 → 调用 `skill_manage` 沉淀为 SKILL.md。

### 轨道2：session 结束时自动审视
session 结束时自动触发：
1. `session_end` hook 读取 session JSONL，提取主题、工具、关键发现
2. `before_prompt_build` hook 在下一个 turn 注入"审视机会"提示
3. Agent 自主判断是否调用 `skill_manage` 沉淀

全程 Agent 决策，不做全自动沉淀。

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
cp -r . ~/.openclaw/extensions/skills-evolution

# 确保 openclaw.json 已配置（plugins.entries 和 plugins.allow）
# 重启 Gateway
openclaw gateway restart
```

## 文件结构

```
index.js                   # 主入口（注册工具 + session_end/before_prompt_build hooks）
openclaw.plugin.json       # 插件清单
package.json               # 含 openclaw.extensions
lib/
  skill-loader.js          # 扫描 ~/.openclaw/workspace/skills/*/SKILL.md
  skill-saver.js           # 写入 SKILL.md
  skill-index.js           # 关键词索引 + TF-IDF 搜索
  session-summarizer.js    # session_end 时提取 session 摘要
```

## 版本

v0.4 — 双轨沉淀：任务中主动 + session 结束时自动审视。
