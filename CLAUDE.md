# OpenClaw Skill Wall - CLAUDE.md

> 项目工作辅助文档

---

## 项目概述

在 OpenClaw 上复刻 Hermes 自进化技能系统。

**技术形态**: OpenClaw Plugin（Node.js）

**三阶段**:
1. Phase 1: Bootstrap 注入 🚧
2. Phase 2: 复盘 + 写 skill ⏳
3. Phase 3: Skill edit/patch ⏳

---

## 文档

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
