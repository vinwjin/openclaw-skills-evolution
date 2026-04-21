# Hermes Skill 系统参考

---

## 一、关键组件

| 组件 | 位置 | 职责 |
|------|------|------|
| **SKILL.md** | `~/.hermes/skills/` | YAML frontmatter + Markdown 正文 |
| **skill_manager_tool.py** | `agent/skill_manager_tool.py` | create/edit/patch/delete |
| **skill_commands.py** | `agent/skill_commands.py` | scan_skill_commands(), load skill |
| **prompt_builder.py** | `agent/prompt_builder.py` | build_skills_system_prompt() |
| **skills_guard.py** | `tools/skills_guard.py` | 安全审查 |

---

## 二、skill_manager_tool.py actions

| action | 说明 | 参数 |
|--------|------|------|
| create | 创建新 skill | name, category, description, content |
| edit | 完整替换 SKILL.md | name, content |
| patch | 局部替换 | name, old_string, new_string |
| delete | 删除 skill | name |
| write_file | 添加支持文件 | name, file_path, content |
| remove_file | 删除支持文件 | name, file_path |

---

## 三、安全审查（skills_guard）

### scan_skill() 检查项

- 敏感信息检测（API keys, tokens, passwords）
- 恶意代码检测（eval, exec, subprocess 等）
- 路径遍历检测（`..` 攻击）
- 内容大小限制（> 100KB 拒绝）

### 流程

```
Agent 创建 skill → scan_skill() → 允许/拒绝
拒绝时返回错误，不写入文件
```

---

## 四、关键代码路径

```
~/.hermes/hermes-agent/
├── agent/
│   ├── skill_manager_tool.py   # skill 创建/编辑
│   ├── skill_commands.py       # skill 加载
│   └── prompt_builder.py       # skills index 构建
└── tools/
    └── skills_guard.py         # 安全审查

~/.npm-global/lib/node_modules/openclaw/
├── dist/                       # OpenClaw 运行时
├── skills/                     # 内置 skills (SKILL.md 格式)
└── docs/reference/             # 文档

~/.openclaw/
├── openclaw.json               # hooks.internal.bootstrap-extra-files 配置
├── extensions/                 # 用户安装的 plugins
│   ├── lossless-claw/         # 参考: context-engine plugin
│   └── openclaw-lark/         # 参考: channel plugin
└── skills/                    # 本地 skills 目录
```