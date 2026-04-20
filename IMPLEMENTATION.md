# OpenClaw Skill Wall — 实施方案

---

## 一、三阶段计划

| Phase | 目标 | 状态 |
|-------|------|------|
| **Phase 1** | Bootstrap 注入 | 🚧 进行中 (Task 1.5 待验证) |
| **Phase 2** | 复盘 + 写 skill | ⏳ |
| **Phase 3** | Skill edit/patch | ⏳ |

---

## 二、Phase 1: Bootstrap 注入

**目标**: 会话开始时扫描 `~/.hermes/skills/`，匹配当前任务，注入 skill 内容

### 任务分解

#### Task 1.1: 创建 plugin 骨架

- [x] 创建 `plugin/` 目录
- [x] 创建 `openclaw.plugin.json`
- [x] 创建 `package.json`
- [x] 创建 `handler.js` 骨架
- [x] 验证 plugin 可被 OpenClaw 识别

**产出**: `plugin/openclaw.plugin.json`, `plugin/package.json`, `plugin/handler.js`

#### Task 1.2: 实现 skill 扫描

- [x] 实现 `scanSkills()` 函数
- [x] 递归扫描 `~/.hermes/skills/` 下所有 `SKILL.md`
- [x] 解析 YAML frontmatter
- [x] 提取 name, description, tags, category
- [x] 验证扫描返回 100+ skills

**产出**: `handler.js` 中的 `scanSkills()` 函数

#### Task 1.3: 实现 YAML frontmatter 解析

- [x] 实现 `parseFrontmatter(content)` 函数
- [x] 支持 `---` 包裹的 YAML 格式
- [x] 提取 frontmatter dict 和 body string
- [x] 错误处理（格式不规范时 graceful fallback）

**产出**: `handler.js` 中的 `parseFrontmatter()` 函数

#### Task 1.4: 实现任务匹配算法

- [x] 实现 `matchSkills(task, skills)` 函数
- [x] 关键词匹配（name × 3, description × 1, tags × 2）
- [x] 返回按分数排序的匹配结果
- [x] 验证匹配结果正确

**产出**: `handler.js` 中的 `matchSkills()` 函数

#### Task 1.5: 实现 bootstrap 注入

- [ ] 研究 `before_prompt_build` hook 的 event 结构
- [ ] 验证 `bootstrapFiles` 是否可写（核心验证点）
- [ ] 实现 hook handler
- [ ] 从 event 提取任务描述
- [ ] 注入 skill 内容
- [ ] 验证注入生效

**候选 hooks**（来自 lossless-claw 分析）:
- `before_prompt_build` — Prompt 构建前
- `session_end` — 会话结束时
- `gateway_start` — 网关启动时

**产出**: `handler.js` 中的 hook handler

#### Task 1.6: 端到端测试

- [ ] 安装 plugin 到 `~/.openclaw/extensions/`
- [ ] 启动 OpenClaw 新会话
- [ ] 验证 skill 注入到 prompt
- [ ] 验证 skill 内容正确

**验收标准**:
- [ ] plugin 可被 OpenClaw 识别
- [ ] skill 扫描返回 100+ Hermes skills
- [ ] 任务匹配正确工作
- [ ] skill 内容注入到 prompt

---

## 三、Phase 2: 复盘 + 写 skill

**目标**: 会话结束后分析 session JSONL，识别有价值的工作流，写入新 skill

### 任务分解

#### Task 2.1: 研究 session JSONL 格式

- [ ] 找到 OpenClaw session 文件路径
- [ ] 解析 JSONL 格式
- [ ] 理解 message 结构（role, content, tool_calls 等）

**产出**: session JSONL 格式文档

#### Task 2.2: 实现 session 分析

- [ ] 实现 `analyzeSession(sessionPath)` 函数
- [ ] 提取 tool calls 和 outcomes
- [ ] 识别错误恢复模式
- [ ] 识别复杂工作流

**产出**: `handler.js` 中的 `analyzeSession()` 函数

#### Task 2.3: 实现经验价值判断

- [ ] 实现 `isValuableExperience(patterns)` 函数
- [ ] 启发式规则判断
- [ ] 阈值可配置

**产出**: `handler.js` 中的 `isValuableExperience()` 函数

#### Task 2.4: 实现 skill 文件生成

- [ ] 实现 `generateSkillMarkdown(experience)` 函数
- [ ] 复用 Hermes SKILL.md 格式
- [ ] 生成符合 ClawHub 标准的 frontmatter

**产出**: `handler.js` 中的 `generateSkillMarkdown()` 函数

#### Task 2.5: 实现 skill 文件写入

- [ ] 实现 `writeSkillFile(skillMarkdown, category, name)` 函数
- [ ] 创建目录结构
- [ ] 写入 `~/.hermes/skills/<category>/<name>/SKILL.md`
- [ ] 幂等性保证（已存在则跳过或更新）

**产出**: `handler.js` 中的 `writeSkillFile()` 函数

#### Task 2.6: 触发机制

- [ ] 研究 session end 触发方式（hook? cron?）
- [ ] 实现触发逻辑
- [ ] 验证自动触发

**验收标准**:
- [ ] session JSONL 分析正确
- [ ] 可识别有价值的工作流模式
- [ ] skill 文件写入成功

---

## 四、Phase 3: Skill edit/patch

**目标**: agent 能够编辑/修改已有的 skill

### 任务分解

#### Task 3.1: 实现 skill edit

- [ ] 实现 `editSkill(name, newContent)` 函数
- [ ] 替换整个 SKILL.md 内容
- [ ] 安全检查（路径验证等）

#### Task 3.2: 实现 skill patch

- [ ] 实现 `patchSkill(name, oldString, newString)` 函数
- [ ] 局部替换 SKILL.md 内容
- [ ] 错误处理（oldString 不存在时）

#### Task 3.3: 注册为 tool

- [ ] 通过 `api.registerTool()` 注册
- [ ] 定义 schema（action, name, old_string, new_string 等）
- [ ] agent 可调用

**验收标准**:
- [ ] agent 可通过 tool 编辑 skill

---

## 五、文件结构（目标）

```
openclaw-skill-wall/
├── README.md
├── ARCHITECTURE.md
├── IMPLEMENTATION.md      # 本文件
├── PUBLISHING.md
├── HERMES.md
├── CLAUDE.md
├── LICENSE
├── _meta.json
├── plugin/
│   ├── openclaw.plugin.json
│   ├── package.json
│   └── handler.js
└── tests/
```

---

## 六、依赖关系

```
Phase 1
├── Task 1.1 (plugin 骨架)
├── Task 1.2 (skill 扫描)
│   └── Task 1.3 (YAML 解析) ←─┐
├── Task 1.4 (任务匹配)         │
│   └── Task 1.2 ────────────────┘
└── Task 1.5 (bootstrap 注入)
    └── Task 1.4 ────────────────────┐
                                     │
Phase 2                                │
├── Task 2.1 (session 格式)            │
├── Task 2.2 (session 分析)           │
│   └── Task 2.1 ─────────────────────┤
├── Task 2.3 (经验判断)               │
│   └── Task 2.2 ─────────────────────┤
├── Task 2.4 (skill 生成)             │
│   └── Task 2.3 ─────────────────────┤
├── Task 2.5 (文件写入)               │
│   └── Task 2.4 ─────────────────────┤
└── Task 2.6 (触发机制)               │
    └── Task 2.5 ─────────────────────┘

Phase 3
├── Task 3.1 (edit) ──→ Phase 2 产出
├── Task 3.2 (patch) ──→ Phase 2 产出
└── Task 3.3 (注册 tool) ──→ Phase 1产出
```
