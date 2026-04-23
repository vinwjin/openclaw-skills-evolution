# Hermes Agent — Skills 自我进化系统分析

> 技能系统是 Hermes 区别于所有其他 Agent 框架的核心创新。

---

## 一、技能创建闭环（7 阶段）

```
① 经验提取
   任务完成（5+ 工具调用）后
   SKILLS_GUIDANCE 提示触发自评
        ↓
② 知识蒸馏
   LLM 提炼本次任务成功的关键步骤
   提取：触发条件、执行流程、常见陷阱
        ↓
③ Skill 文件生成
   → skills/ 目录写入新 .md 文件
   格式：触发条件 + 执行步骤 + 验证方法
        ↓
④ 技能索引更新
   build_skills_system_prompt() 更新索引
   名称 + 描述 → 按需加载全文
        ↓
⑤ 智能检索
   下次遇到类似任务
   模糊匹配 → 相关 Skill 全文注入上下文
        ↓
⑥ 执行验证
   加载 Skill → 按步骤执行
   执行中发现问题 → 触发改进
        ↓
⑦ 自动改进
   hermes-agent-self-evolution (DSPy + GEPA)
   优化 Skill 的提示词和参数
```

---

## 二、SKILLS_GUIDANCE 触发机制

**位置**: `agent/prompt_builder.py`

**核心提示词**:
```
After completing a complex task (5+ tool calls), fixing a tricky error,
or discovering a better approach — consider creating or updating a Skill.
```

| 特点 | 说明 |
|------|------|
| 触发方式 | 写在系统提示里，不是硬编码逻辑 |
| 判断者 | LLM 自己判断什么时候该写 Skill |
| 触发条件 | 复杂任务(5+工具调用)、修复错误、发现更好的方法 |

---

## 三、Skills 四级加载策略

```
┌─────────────────────────────────────────────────────────────┐
│ Level 1: 技能索引（只加载名称+描述）                          │
│          用于快速匹配判断需要哪些 Skill                        │
└─────────────────────────────┬───────────────────────────────┘
                              ↓ 匹配成功
┌─────────────────────────────────────────────────────────────┐
│ Level 2: 技能全文（按需加载完整内容）                          │
│          触发条件 + 执行步骤 + 验证方法                         │
└─────────────────────────────┬───────────────────────────────┘
                              ↓ 执行中发现偏差
┌─────────────────────────────────────────────────────────────┐
│ Level 3: 上下文修正（in-context adjustment）                 │
│          LLM 根据当前情况微调 Skill 步骤                      │
└─────────────────────────────┬───────────────────────────────┘
                              ↓ 任务完成
┌─────────────────────────────────────────────────────────────┐
│ Level 4: 自学习更新（写回 Skill 文件）                        │
│          如果执行中有新发现，更新 Skill 内容                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 四、hermes-agent-self-evolution 模块

**仓库结构**:
```
hermes-agent-self-evolution/
├── datasets/    ← 训练数据（成功/失败轨迹）
├── evolution/   ← GEPA 优化算法
├── reports/     ← 进化报告
└── tests/       ← 验证套件
```

| 组件 | 说明 |
|------|------|
| DSPy | 声明式编程框架 |
| GEPA | Prompt 优化算法 |
| 目标 | 用机器学习优化 Skill 的提示词和参数 |

---

## 五、内置 Skills 目录结构

```
skills/
├── mlops/          ← MLOps 相关技能
├── web_tools/      ← Web 搜索/爬虫技能
├── file_ops/       ← 文件操作技能
├── coding/         ← 代码相关技能
└── ...
optional-skills/    ← 可选安装的额外技能
```

---

## 六、vs OpenClaw 实现对比

| 特性 | Hermes | OpenClaw (v0.6) |
|------|--------|-----------------|
| Skill 创建触发 | SKILLS_GUIDANCE 提示 | Agent 自主判断 |
| 自动分析 | 内置 LLM | 工具模式（skill_manage） |
| 自学习进化 | DSPy + GEPA | 不支持 |
| 加载策略 | 4 级按需加载 | 全文加载 |
| 存储 | 文件系统 | 文件系统 |
| Hooks | session_start/end | session_end + before_prompt_build |
| 上下文压缩 | ContextCompressor | CompactionProvider（两阶段） |
| 防震荡 | 是 | 是（cooldown 300s） |