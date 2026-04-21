---
name: hermes-skill-self-evolution
description: Hermes Agent 自我进化技能系统深度分析（2026-04-21）
---

# Hermes Agent 自我进化技能系统深度解析

## 一、核心设计哲学

Hermes 的 Skill 不是"文档库"，是** Agent 的程序化记忆**。

- **Memory（MEMORY.md）**：声明性事实，干式规则——宽泛、持久
- **Skills（SKILL.md）**：程序化流程，可执行动作——窄、专精、可执行
- **界限**：流程/工作流/步骤 → skills；规则/偏好/事实 → memory

## 二、三阶段闭环

```
[启动时]                    [任务中]                    [任务后]
scan_skills()             agent 主动查              session_end
build_skills_prompt()       skill               →  发现值得沉淀的模式
  (compact index            match task              →  skill_manager tool
   注入 system prompt)      load skill              →  写入 ~/.hermes/skills/
                             execute
```

### 阶段 1：启动时加载（Skills Index）

**机制**：`prompt_builder.build_skills_system_prompt()`

1. 扫描 `~/.hermes/skills/` 下所有 `SKILL.md`
2. 解析 frontmatter，提取 `name` + `description`
3. 按 category 分组，生成紧凑索引注入 system prompt
4. **两-layer 缓存**：in-process LRU + 磁盘 snapshot（`.skills_prompt_snapshot.json`）

**Agent 看到的 system prompt 内容**：
```
## Skills (mandatory)
Before replying, scan the skills below. If a skill matches or is even partially
relevant to your task, you MUST load it with skill_view(name) and follow its
instructions. Err on the side of loading — it is always better to have context
you don't need than to miss critical steps, pitfalls, or established workflows.
Skills contain specialized knowledge — API endpoints, tool-specific commands, and
proven workflows that outperform general-purpose approaches. Load the skill even
if you think you could handle the task with basic tools like web_search or
terminal.

Category: software-development
- github-pr-workflow / GitHub PR workflow / Complete pull request lifecycle...
- systematic-debugging / Systematic debugging methodology...

Category: mlops
- ollama-remote-invoke / Invoke Ollama on remote host...
```

**注入方式**：Skills 索引作为 **system prompt 的一部分**（不是 bootstrapFiles），让 LLM 在每轮对话都能看到全部可用 skill 的名字和描述。

**关键**：索引是"名字+描述"紧凑列表，不是完整内容。完整内容通过 `skill_view(name)` **按需加载**。

### 阶段 2：任务中主动查询（关键！）

**Agent 行为规则**（写在 system prompt SKILLS_GUIDANCE）：

```
"Before replying, scan the skills below. If a skill matches or is even
partially relevant, you MUST load it with skill_view(name) and follow its
instructions."
```

**触发条件**：Agent 被指示"主动"在回复前检查——不是等用户说"用 skill"才查。

**加载机制**：
- `skill_view(name)` tool 读取完整 SKILL.md 内容
- Skill 内容作为 **user message 注入**（不是 system prompt）——这样 Anthropic 的 prompt caching 能生效
- Agent 加载 skill 后，严格按 skill 的步骤执行

### 阶段 3：任务后自动沉淀

**触发条件**（SKILLS_GUIDANCE in system prompt）：

```
"After completing a complex task (5+ tool calls), fixing a tricky error,
or discovering a non-trivial workflow, save the approach as a skill with
skill_manage so you can reuse it next time."
```

**决策权**：Agent **自主判断**是否值得沉淀，不需要用户说"保存 skill"。

**Skill Manager Tool actions**：

| Action | 说明 |
|--------|------|
| `create` | 创建新 skill（SKILL.md + 目录结构） |
| `edit` | 完整替换 SKILL.md |
| `patch` | 局部替换（find-and-replace） |
| `delete` | 删除 skill |
| `write_file` | 添加 supporting file |
| `remove_file` | 删除 supporting file |

**Skill 创建时的安全检查**：写入前通过 `skills_guard.scan_skill()` 审查内容。

## 三、Skill 格式标准

```yaml
---
name: skill-name                    # Required, max 64 chars
description: Brief description      # Required, max 1024 chars
version: 1.0.0                     # Optional
platforms: [macos, linux]           # Optional — OS 兼容性
prerequisites:                      # Optional — 环境要求
  env_vars: [API_KEY]
  commands: [curl, jq]
metadata:
  hermes:
    tags: [openclaw, plugin]
    related_skills: [other-skill]
---

# Skill Title

## When to Use

✅ USE this skill when: ...
❌ DON'T use this skill when: ...

## Steps

1. ...
2. ...
```

## 四、与 OpenClaw 的架构对照

| 机制 | Hermes | OpenClaw（当前） | 差距 |
|------|--------|-----------------|------|
| Skill 索引 | `build_skills_system_prompt()` → system prompt | `before_prompt_build` hook → bootstrapFiles | ⚠️ bootstrapFiles 可能不生效 |
| Skill 匹配 | Agent 被指示"主动查"，system prompt 有明确规则 | `matchSkills()` 在 hook 里做关键词匹配 | ❌ Agent 看不到索引，不知道要查 |
| Skill 内容加载 | `skill_view(name)` 按需加载，内容注入 user message | 无按需加载机制 | ❌ 全文注入可能超长 |
| Skill 创建 | `skill_manager` tool，Agent 自主决策 | `session_end` hook 分析 JSONL，生成草稿到 `generated-skills/` | ❌ 草稿不自动注册 |
| Skill 存储 | `~/.hermes/skills/` | `~/.openclaw/workspace/skills/` | ✅ 已修正 |
| 触发规则 | System prompt 里明确写"完成复杂任务后 save as skill" | 无 | ❌ Agent 不知道要复盘 |

## 五、最核心的差距

**当前 OpenClaw 实现是"后台处理"模式**：
- Hook 在后台扫描、匹配、生成草稿
- Agent **不知道**有哪些 skill，**不知道**任务完成后要复盘沉淀

**Hermes 是"前台协作"模式**：
- System prompt 明确告诉 Agent：有哪些 skill、要在回复前主动查、复杂任务后要沉淀
- Agent 是自我进化系统的**主动参与者**，不是被动的工具执行者

**OpenClaw 需要的核心改动**：不是更多 hook，而是让 Agent **知道**这个系统的存在并主动参与。
