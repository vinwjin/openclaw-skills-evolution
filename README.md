# OpenClaw Skill Wall

> 在 OpenClaw 上复刻 Hermes 自进化技能系统

---

## 目标

让 OpenClaw agent **主动搜索已有 skill**，不重复造轮子；**任务完成后自动复盘沉淀**，形成可复用技能。

```
任务开始前 → 搜索已有 skill → 匹配则调用
任务完成后 → 复盘分析 → 有价值经验 → 写成 skill 文件
技能像软件一样安装、更新、分享
```

---

## 核心功能

| Phase | 功能 | 状态 |
|-------|------|------|
| **Phase 1** | Skill 推荐：会话开始时扫描 `~/.openclaw/workspace/skills/`，匹配任务，注入到 prompt | ✅ |
| **Phase 2** | 经验沉淀：会话结束后分析 JSONL，识别有价值模式，写入 skill 草稿 | ✅ |
| **Phase 3** | Skill 编辑：agent 可通过 `skill_editor` tool 编辑/修改已有 skill | ✅ |

---

## 技术形态

**OpenClaw Plugin**（Node.js，零外部依赖）

- `before_prompt_build` hook → 注入匹配的 skill
- `session_end` hook → 分析会话，生成 skill 草稿
- `skill_editor` tool → agent 调用编辑 skill
- Skill 存储在 `~/.openclaw/workspace/skills/`（OpenClaw 自己的 skill 库）

---

## 安装

```bash
# 源码目录
ln -s /path/to/openclaw-skill-wall/plugin ~/.openclaw/extensions/skill-wall
```

验证：
```bash
openclaw plugins list | grep skill-wall
# skill-wall  → loaded ✅
```

---

## 项目结构

```
openclaw-skill-wall/
├── README.md                      # 本文档
├── CLAUDE.md                      # AI 工作辅助
├── LICENSE
├── _meta.json                     # ClawHub 元数据
├── docs/
│   ├── design/skill-system.md     # 设计原理
│   ├── guides/publishing.md        # ClawHub 发布指南
│   ├── guides/security.md          # 安全政策
│   └── references/hermes-reference.md  # Hermes 参考
└── plugin/
    ├── openclaw.plugin.json        # Plugin 元数据
    ├── package.json                # npm 包配置
    ├── handler.js                  # 主逻辑（hook + tool）
    ├── lib/
    │   └── skill-generator.js      # Phase 2 核心（session 分析 + skill 生成）
    ├── skills/skill-wall/SKILL.md  # Plugin 自带的 skill
    └── test/
        ├── event-structure.js          # 事件结构测试
        ├── verify-event-structure.mjs  # 验证脚本
        └── test-session-end.js         # Phase 2 单元测试
```

---

## 验证状态

- `openclaw plugins list` → skill-wall ✅ loaded
- Phase 1 事件结构测试 → 5/5 通过
- Phase 2 session 分析测试 → 13/13 通过
- skills 目录路径 → `~/.openclaw/workspace/skills/` ✅ 已修正
