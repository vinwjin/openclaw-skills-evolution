# OpenClaw Skills Evolution — CLAUDE.md

## 项目概述

**目标**：让 OpenClaw Agent 拥有自我进化能力——在任务中主动沉淀可复用经验，同时自动管理对话上下文避免溢出。

**当前版本**：v0.6（压缩功能）

**三大轨道**：
1. 任务中主动沉淀（skill_manage）
2. session 结束时自动审视
3. 上下文自动压缩（CompactionProvider）

---

## 技术架构

### Hooks
```js
api.on('session_end', async (event, ctx) => { ... })
api.on('before_prompt_build', async (event, ctx) => { ... })
api.on('before_compaction', async (event, ctx) => { ... })
api.on('after_compaction', async (event, ctx) => { ... })
```

### CompactionProvider
```js
class CompactionProvider {
  async initialize() { ... }
  async isNeeded(tokenCount, messageCount) { ... }
  async compact(messages, reason) { ... }
}
```

### 防震荡机制
- 连续2次压缩节省 <10% → 暂停，cooldown = 300s
- 状态持久化到 `compaction-throttle.json`

---

## 文件结构
```
skills-evolution/
├── index.js                          # 主入口（注册工具 + hooks）
├── compaction-config.json            # 压缩配置
├── lib/
│   ├── compaction-provider.js         # CompactionProvider 两阶段压缩
│   ├── compaction-throttle.js         # 防震荡状态管理
│   ├── session-summarizer.js          # session 摘要提取
│   ├── skill-loader.js                # 扫描 workspace/skills/
│   ├── skill-saver.js                 # 写入 SKILL.md
│   └── skill-index.js                 # 关键词索引 + TF-IDF 搜索
└── scripts/
    └── compaction-summarizer.js      # LLM 摘要子进程
```

---

## 版本历史

| 版本 | 日期 | 内容 |
|------|------|------|
| v0.6 | 2026-04-24 | CompactionProvider + before/after_compaction hooks，上下文自动压缩 |
| v0.5.1 | 2026-04-23 | 安全修复：Prompt 注入、符号链接覆盖、敏感泄露、DoS |
| v0.4 | 2026-04-22 | 双轨沉淀 + session_end/before_prompt_build hooks |
| v0.3 | 2026-04-21 | 基础 Skills CRUD + 搜索 |

---

## 已验证功能

### v0.6 压缩功能
- ✅ CompactionProvider 注册成功
- ✅ 两阶段压缩（工具剪枝 + LLM 摘要）
- ✅ 防震荡机制（cooldown 状态持久化）
- ✅ 语法验证全部通过（41 tests pass）
- ⚠️ **端到端压力测试完成——见下方实测结论**

### 压力测试结论（2026-04-24）

**测试方法**：通过 Dashboard 连续发送 2 个重型任务，触发 sub-agent 大量消耗 context，观察 compaction 是否触发。

**实测数据**：
- 任务1：Flask REST API 50+ 接口，ctx 从 17% → 100%，sub-agent 最高 R 消耗 2.8M tokens
- 任务2：Flask 电商扩展，ctx 从 36% → 49%，sub-agent 最高 R 消耗 2M tokens，agent 仍在工作
- 全程 `compaction-throttle.json` 从未创建

**结论**：Gateway 的 **session 刷新机制**（context exhaustion fallback）在 compaction 阈值达到之前就介入了。compaction hook 没有机会执行。

**根因**：Gateway 检测到 context 接近上限 → 触发 session 刷新 → 刷新后 compaction hook 根本没机会看 session 状态

**下一步验证建议**：
1. 降低 `thresholdPercent` 到 0.2（更激进），让 compaction 在 gateway 刷新之前触发
2. 或者在没有 sub-agent 的场景下，用大量单轮对话积累中间消息到触发点
3. 检查 gateway 的 session 刷新阈值配置，确认与 compaction threshold 的先后关系

---

## 待做
- [ ] 降低 thresholdPercent 重测 compaction 触发
- [ ] 确认 gateway session 刷新与 compaction 触发的先后顺序
- [ ] 无 sub-agent 场景下的单轮对话压力测试
