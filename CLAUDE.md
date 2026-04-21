# OpenClaw Skills Evolution — CLAUDE.md

## 项目概述
**目标**：对标 Hermes Skills 自我进化机制，实现双轨沉淀：

1. **轨道1**：任务过程中 Agent 主动调用 skill_manage 沉淀经验
2. **轨道2**：session 结束时自动审视 → Agent 决定是否创建 skill

**v0.4 设计**：在 v0.3 基础上加入 session_end + before_prompt_build hooks，实现自动审视机会。

---

## 双轨机制详解

### 轨道1：主动沉淀（工具模式）
Agent 在任务中发现值得复用的模式 → 主动调用 `skill_manage create` → 写入 `~/.openclaw/workspace/skills/{safeName}/SKILL.md`

### 轨道2：自动审视（Hook 模式）
```
session_end
  → SessionSummarizer 读取 session JSONL
  → 生成摘要（topic, tools, keyFindings）
  → 存入 sessionRegistry（Map: sessionId → summary）

before_prompt_build
  → 检查 sessionRegistry 是否有待审视 session
  → 注入审视提示到 system prompt
  → 清除注册表条目
  → Agent 在下一个 turn 决定是否创建 skill
```

**关键**：全程 Agent 自主决策，不做全自动沉淀。Hook 只是创造一次审视机会。

---

## 技术规格

### Hooks 注册
```js
api.on('session_end', async (event, ctx) => { ... })
api.on('before_prompt_build', async (event, ctx) => { ... })
```

### sessionRegistry 全局注册表
```js
const sessionRegistry = new Map();
// {
//   sessionId: { topic, tools, keyFindings, timestamp }
// }
```

### session-summarizer.js
- 读取 session JSONL
- 提取：topic（用户首条消息前80字符）、tools（用到的工具）、keyFindings（代码片段）
- 返回 `{ topic, tools, keyFindings }`

### buildReviewPrompt(entry)
在 system prompt 后追加审视提示：
```
## 经验审视机会
上一个 session 主题：{topic}
工具: {tools}
如果这个 session 中发现了值得复用的解决方案...考虑调用 skill_manage create 沉淀为 SKILL.md。
```

---

## Skills 存储路径
```
~/.openclaw/workspace/skills/{safeName}/SKILL.md
```

### safeName 规则
```js
function toSafeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

### SKILL.md 格式
```yaml
---
name: example-skill
description: 这是一个示例 Skill
triggers:
  - 当做某事时
tags:
  - 标签1
version: 1.0.0
author: openclaw
---

# Skill 内容
正文...
```

---

## 文件结构
```
openclaw-skills-evolution/
├── CLAUDE.md
├── README.md
├── _meta.json                  # version: 0.4.0
├── index.js                    # 主入口（注册工具 + hooks）
├── openclaw.plugin.json        # { id, name, configSchema }
├── package.json               # { openclaw: { extensions: ["./index.js"] } }
└── lib/
    ├── skill-loader.js         # 扫描 workspace/skills/*/SKILL.md
    ├── skill-saver.js          # 写入 SKILL.md
    ├── skill-index.js          # 关键词索引 + TF-IDF 搜索
    └── session-summarizer.js   # session JSONL 摘要提取
```

---

## 状态

| 组件 | 状态 |
|------|------|
| `plugin/index.js` | ✅ 完成 |
| `lib/session-summarizer.js` | ✅ 完成 |
| `lib/skill-loader.js` | ✅ 完成 |
| `lib/skill-saver.js` | ✅ 完成 |
| `lib/skill-index.js` | ✅ 完成 |
| `plugin/openclaw.plugin.json` | ✅ 完成 |
| `plugin/package.json` | ✅ 完成 |
| README.md | ✅ 完成 |
| 安装目录同步 | ⏳ 待做 |
| Gateway 重启 | ⏳ 待做 |
| 实际验证（双轨测试） | ⏳ 待做 |

---

## 已验证功能（v0.3）

### 测试 1：提示创建
- 任务：提示"整理 Windows 路径规则并沉淀为 Skill"
- 结果：✅ windows-path Skill 创建成功

### 测试 2：自发沉淀（无提示）
- 任务：调研 WSL PATH 冲突问题，**不提示沉淀**
- 结果：✅ Agent 自发创建 wsl-windows-path Skill

---

## 待测试（v0.4）

### 测试 3：轨道2 — session_end 自动审视
- 触发：session 结束时
- 预期：下一个 turn 开头有审视提示
- 预期：Agent 决定是否创建 skill
