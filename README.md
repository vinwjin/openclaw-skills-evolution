# OpenClaw Skills Evolution

让 OpenClaw Agent 拥有"自我进化"能力——在任务中主动沉淀可复用经验，同时自动管理对话上下文，避免上下文溢出。

[![npm version](https://img.shields.io/npm/v/@vinwjin/openclaw-skills-evolution)](https://www.npmjs.com/package/@vinwjin/openclaw-skills-evolution)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 核心功能

### 🧠 轨道1：任务中主动沉淀（Skills 自我进化）
Agent 在完成复杂任务时，主动发现值得固化的解决方案 → 调用 `skill_manage create` → 写入 `~/.openclaw/workspace/skills/{name}/SKILL.md`。

> 对标 Hermes Skills 机制，让经验在多个 session 之间流动。

### 🔄 轨道2：session 结束时自动审视
session 结束时自动触发：
1. `session_end` hook 读取 session JSONL，提取主题 / 工具 / 关键发现
2. `before_prompt_build` hook 在下一个 turn 注入"审视机会"提示
3. Agent 自主决策是否创建 Skill

### 🗜️ 轨道3：上下文自动压缩
当对话上下文超过阈值时，自动触发两阶段压缩：

**阶段1 — 工具输出剪枝（无 LLM 调用）**
- 大工具输出 → 信息摘要：`[terminal] ran npm test → exit 0, 47 lines`
- 保留关键信息，丢弃冗余字符

**阶段2 — LLM 摘要中间轮次**
- 保护 head（system + 首批交换）和 tail（最近上下文）
- 中间轮次用辅助模型压缩为摘要

> 对标 Hermes `ContextCompressor`，但专为 OpenClaw 插件生态设计。

---

## 工具集

| 工具 | 说明 |
|------|------|
| `skill_manage` | 创建 / 编辑 / 补丁 / 删除 SKILL.md |
| `skill_list` | 列出所有 Skills |
| `skill_search` | 关键词搜索 Skills |
| `trigger_review` | 主动触发 session 审视 |
| `trigger_deep_review` | 启动后台深度固化 |

---

## 安装

### openclaw plugins install（推荐）
```bash
openclaw plugins install @vinwjin/openclaw-skills-evolution
```

### npm 全局安装
```bash
npm install -g @vinwjin/openclaw-skills-evolution
```

### 一键安装（curl）
```bash
curl -fsSL https://raw.githubusercontent.com/vinwjin/openclaw-skills-evolution/master/install.sh | bash
```

### 手动安装
```bash
git clone https://github.com/vinwjin/openclaw-skills-evolution.git \
  ~/.openclaw/extensions/skills-evolution
systemctl --user restart openclaw-gateway.service
```

---

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

# Skill 内容
正文...
```

---

## 配置

### 压缩阈值（compaction-config.json）
```json
{
  "enabled": true,
  "thresholdPercent": 0.5,
  "protectFirstN": 3,
  "protectLastN": 20,
  "summaryTargetRatio": 0.2,
  "model": "MiniMax-M2.7",
  "provider": "minimax-cn",
  "baseUrl": "https://api.minimaxi.com/v1",
  "apiKeyEnv": "MINIMAX_API_KEY",
  "timeout": 120,
  "maxSummaryTokens": 4000
}
```

---

## 文件结构

```
openclaw-skills-evolution/
├── index.js                          # 主入口
├── compaction-config.json            # 压缩配置
├── lib/
│   ├── skill-loader.js               # 扫描 workspace/skills/
│   ├── skill-saver.js                # 写入 SKILL.md
│   ├── skill-index.js                # 关键词索引 + TF-IDF 搜索
│   ├── session-summarizer.js         # session 摘要提取
│   ├── compaction-throttle.js        # 防震荡状态管理
│   └── compaction-provider.js        # CompactionProvider 实现
└── scripts/
    └── compaction-summarizer.js     # LLM 摘要子进程
```

---

## 版本

| 版本 | 说明 |
|------|------|
| v0.6 | 新增 `CompactionProvider` + `before/after_compaction` hooks，实现上下文自动压缩 |
| v0.5 | 安全修复：Prompt 注入、符号链接覆盖、敏感信息泄露、DoS |
| v0.4 | 双轨沉淀：任务中主动 + session 结束时自动审视 |
| v0.3 | 基础 Skills CRUD + 搜索 |
