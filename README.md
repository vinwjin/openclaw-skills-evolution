# OpenClaw Skill Wall

> 在 OpenClaw 上复刻 Hermes 自进化技能系统

---

## 项目目标

在 OpenClaw 上实现 Hermes Agent 的**自进化技能系统**：

```
解决了一个复杂问题 → 保存成技能文档
发现了新工作流     → 保存成技能
被用户纠正了      → 保存成记忆
技能像软件一样安装、更新、分享
每次新会话自动加载，成为 Agent 能力的一部分
```

---

## 核心功能

### Phase 1: Skill 主动推荐

- 会话开始时扫描 `~/.hermes/skills/`
- 匹配当前任务
- 注入 skill 内容到 prompt

### Phase 2: 经验沉淀

- 会话结束后分析 session JSONL
- 识别有价值的工作流
- 自动固化为 skill 文件

### Phase 3: Skill 编辑

- agent 可编辑/修改已有的 skill

---

## 技术形态

**OpenClaw Plugin**（Node.js）

- 通过 `before_prompt_build` hook 注入 skill
- Skill 文件格式复用 Hermes 标准
- 存储在 `~/.hermes/skills/`

---

## 项目状态

🚧 **Phase 1 核心逻辑完成（plugin 未加载）**
- Phase 1: 核心代码完成，3/6 tasks 完成，⚠️ plugin 加载问题待修复
- Phase 2: 9/12 测试通过（3 个失败）
- Phase 3: 未开始

---

## 文档

| 文档 | 说明 |
|------|------|
| ARCHITECTURE.md | 技术架构 |
| IMPLEMENTATION.md | 实施计划与任务分解 |
| HERMES.md | Hermes Skill 系统参考 |
| PUBLISHING.md | ClawHub 发布指南 |
| CLAUDE.md | 工作辅助 |

---

## 安装

```bash
# 链接到 OpenClaw extensions 目录
ln -s /path/to/openclaw-skill-wall/plugin ~/.openclaw/extensions/skill-wall
```

---

## License

MIT
