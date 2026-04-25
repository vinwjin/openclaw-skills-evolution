# OpenClaw Skills Evolution

让 OpenClaw Agent 拥有“自我进化”能力：在任务中主动沉淀可复用经验，在 session 结束后自动审视，并在上下文接近上限时执行智能压缩。

[![npm version](https://img.shields.io/npm/v/@vinwjin/openclaw-skills-evolution)](https://www.npmjs.com/package/@vinwjin/openclaw-skills-evolution)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 0.6.3 更新

- compaction provider 现在优先复用 OpenClaw 当前会话的鉴权、provider 与默认模型。
- 子进程摘要器新增 `openai-completions` 与 `anthropic-messages` 两种 API 传输适配。
- 补齐发布文档、打包清单与回归测试，便于 GitHub / npm 同步发布。

---

## 核心能力

### 1. 任务中主动沉淀（Skills 自我进化）
Agent 在完成复杂任务时，可以主动识别值得固化的解决方案，并调用 `skill_manage create` 写入 `~/.openclaw/workspace/skills/{name}/SKILL.md`。

### 2. session 结束时自动审视
- `session_end` hook 读取 session JSONL，提取主题、工具与关键发现。
- `before_prompt_build` hook 在下一轮注入“审视机会”提示。
- Agent 决定是否把本轮经验固化成 Skill。

### 3. 上下文自动压缩
当上下文逼近阈值时，插件会执行两阶段压缩：

- **阶段 1：工具输出剪枝** — 先把体积大的工具输出压缩成一行摘要，避免把冗长日志直接送给 LLM。
- **阶段 2：中间轮次总结** — 保留 head / tail 关键上下文，只对中间轮次调用辅助模型生成 handoff summary。

---

## 工具集

| 工具 | 说明 |
| --- | --- |
| `skill_manage` | 创建 / 编辑 / 补丁 / 删除 `SKILL.md` |
| `skill_list` | 列出全部 Skills |
| `skill_search` | 关键字搜索 Skills |
| `trigger_review` | 主动触发 session 审视 |
| `trigger_deep_review` | 启动后台深度固化 |

---

## 安装

### 推荐：OpenClaw 插件安装
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

## OpenClaw compaction 接入

要让“上下文自动压缩”接管 OpenClaw 的 compaction，需要在 `openclaw.json` 中启用本插件注册的 provider：

```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "provider": "skills-evolution-compactor"
      }
    }
  }
}
```

如果使用仓库中的 `install.sh` 或 `scripts/postinstall.sh`，且机器安装了 `jq`，脚本会在未设置其他 provider 时自动补齐这项配置。

---

## compaction-config.json

```json
{
  "enabled": true,
  "thresholdPercent": 0.2,
  "protectFirstN": 3,
  "protectLastN": 20,
  "summaryTargetRatio": 0.2,
  "preferOpenClawAuthModel": true,
  "model": "MiniMax-M2.7",
  "provider": "minimax-cn",
  "api": "openai-completions",
  "baseUrl": "https://api.minimaxi.com/v1",
  "apiKeyEnv": "MINIMAX_API_KEY",
  "timeout": 120,
  "maxSummaryTokens": 4000
}
```

### 配置说明

- `preferOpenClawAuthModel`：优先使用 OpenClaw 当前会话里的 provider、默认模型和鉴权；失败时再回退到插件自己的 `provider/model/apiKeyEnv` 配置。
- `api`：摘要子进程使用的 API 传输类型，当前支持 `openai-completions` 与 `anthropic-messages`。
- `thresholdPercent`：中间上下文占比达到该阈值时才进入 LLM 摘要阶段。

---

## 文件结构

```text
openclaw-skills-evolution/
├── index.js
├── compaction-config.json
├── lib/
│   ├── skill-loader.js
│   ├── skill-saver.js
│   ├── skill-index.js
│   ├── session-summarizer.js
│   ├── compaction-throttle.js
│   └── compaction-provider.js
└── scripts/
    └── compaction-summarizer.js
```

---

## 版本

| 版本 | 说明 |
| --- | --- |
| `v0.6.3` | OpenClaw host 鉴权/模型优先、补齐双 API 传输、完善发布文档与测试 |
| `v0.6` | 新增 `CompactionProvider` 与 `before/after_compaction` hooks，实现上下文自动压缩 |
| `v0.5` | 安全修复：Prompt 注入、符号链接覆盖、敏感信息泄露、DoS |
| `v0.4` | 双轨沉淀：任务中主动固化 + session 结束时自动审视 |
| `v0.3` | 基础 Skills CRUD + 搜索 |

详细变更见 [CHANGELOG.md](./CHANGELOG.md)。
