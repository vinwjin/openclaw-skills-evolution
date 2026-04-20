# OpenClaw Skill Wall - CLAUDE.md

> 项目工作辅助文档

---

## 项目概述

在 OpenClaw 上复刻 Hermes 自进化技能系统。

**技术形态**: OpenClaw Plugin（Node.js）

**三阶段**:
1. Phase 1: Bootstrap 注入 ✅ 核心逻辑完成（⚠️ plugin 未加载）
2. Phase 2: 复盘 + 写 skill ⚠️ 9/12 测试通过
3. Phase 3: Skill edit/patch ⏳ 未开始

---

## 当前阻塞问题

**plugin 未加载**
- 症状：`openclaw plugins list` 中无 skill-wall
- 符号链接：`~/.openclaw/extensions/skill-wall` ✅ 已创建
- 可能原因：`package.json` 缺少 `exports` 字段
- 参考：openclaw-lark 使用 `dist/index.js`，skill-wall 直接暴露根目录

---

## 技术约束

| 文档 | 说明 |
|------|------|
| README.md | 项目整体说明 |
| ARCHITECTURE.md | 技术架构 |
| IMPLEMENTATION.md | 实施计划 |
| PUBLISHING.md | 发布指南 |
| HERMES.md | Hermes Skill 系统参考 |

---

## 技术约束

1. **不能修改 OpenClaw 源码** — 必须通过 Plugin 机制
2. **语言隔离** — Hermes (Python) ↔ OpenClaw (Node.js)
3. **安全第一** — 复用 Hermes skill 格式

---

## Karpathy 编程原则

1. **Think Before Coding** — 不确定就问
2. **Simplicity First** — 只写必要的代码
3. **Surgical Changes** — 只改该改的
4. **Goal-Driven Execution** — 每步有验收标准
