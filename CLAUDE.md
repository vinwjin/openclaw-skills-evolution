# OpenClaw Skill Wall - CLAUDE.md

> 项目工作辅助文档

---

## 项目概述

在 OpenClaw 上复刻 Hermes 自进化技能系统。

**技术形态**: OpenClaw Plugin（Node.js）

**架构对齐**（参考 openclaw-lark）:
- Skills 由 OpenClaw 原生发现（`~/.openclaw/workspace/skills/`）
- Plugin 负责：Skill System Prompt 注入 + skill_editor 工具 + session 分析
- Agent 看到的是"前台可见"的 skill 系统，不是后台偷偷注入

**三阶段**:
1. Phase 1: Skill System Prompt 注入 ✅ 改为前台可见方式
2. Phase 2: 复盘 + 生成 skill ✅ 13/13 测试通过
3. Phase 3: Skill edit/patch ✅ 全部完成（editSkill + patchSkill + registerTool）

---

## 当前阻塞问题

无阻塞。

**plugin 状态**（`openclaw plugins list`）：
- skill-wall ✅ 已安装，已启用，`loaded` 状态
- 安装路径：`~/.openclaw/extensions/skill-wall/`（cp -r 复制，不使用 symlink）

---

## 技术约束

1. **不能修改 OpenClaw 源码** — 必须通过 Plugin 机制
2. **语言隔离** — Hermes (Python) ↔ OpenClaw (Node.js)
3. **安全第一** — 复用 Hermes skill 格式

---

## Karpathy 编程原则

> 来源: [forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills)

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
