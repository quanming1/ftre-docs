# Skill

Skill 是 ftre 的可复用能力模块——把工作流程、领域知识、工具用法沉淀成 Markdown 文件，Agent 按需加载到当前任务。

## 概述

| 特性 | 说明 |
|------|------|
| 全局存储 | `~/.ftre/skills/` |
| 私有存储 | `~/.ftre/agents/<agent_id>/skills/`（仅该 Agent 可见，同名覆盖全局） |
| 文件格式 | `name.md`、`name/SKILL.md` 或 `name/skill.md` |
| 加载方式 | 用户点名 → Agent 调 `loadSkill` 读取，或 Agent 自动匹配 |
| 作用域 | 当前对话 session，不跨 session 污染 |

## 目录结构

```
~/.ftre/skills/                    ← 全局 Skill
├── frontend-design.md             # 单文件 Skill
├── mcp-guide/
│   ├── SKILL.md                   # Skill 主入口（必需）
│   └── references/
│       └── troubleshooting.md     # 参考文档
└── skill-creator/
    └── SKILL.md

~/.ftre/agents/coder/skills/       ← coder 私有 Skill
└── python-strict-check.md
```

- 单文件：`<name>.md`
- 目录形式：`<name>/SKILL.md`（或 `<name>/skill.md`），可附带 `references/` 子目录存放扩展文档

## 触发机制

### 1. 点名触发

用户明确提到某个 Skill 名称时，Agent 调用 `loadSkill` 加载：

```
用户: "用 frontend-design 帮我做这个页面"
→ Agent 调用 loadSkill("frontend-design") 读取 SKILL.md
```

### 2. 自动匹配

每个 Skill 在系统提示词中有能力描述摘要。Agent 检测到用户需求匹配某 Skill 的能力描述时，自动加载。

### 3. 单次加载

同一 Skill 在当前对话中只加载一次，避免重复读取。

## 私有 Skill

Agent 目录下可创建 `skills/` 子目录，存放该 Agent 专属的 Skill。合并规则：

- **列表展示**：全局 + 当前 Agent 私有合并，同名 Skill 私有版本覆盖全局
- **加载顺序**：`loadSkill` 工具先搜私有目录，再搜全局目录
- **前端 `/` 弹窗**：根据当前选中的 Agent 显示全局 + 该 Agent 私有的 Skill 列表

## 编写自己的 Skill

### 最小 Skill

```markdown
# my-skill

## 能力
当用户需要 X 时触发本 Skill。

## 流程
1. 第一步
2. 第二步

## 示例
用户："帮我做 X"
```

保存为 `~/.ftre/skills/my-skill.md` 即可。

### 带参考文档的 Skill

```
~/.ftre/skills/my-skill/
├── SKILL.md              # 主入口：能力描述 + 核心流程
└── references/
    ├── setup-guide.md    # 安装配置指南
    └── advanced.md       # 高级用法
```

Agent 可在 SKILL.md 中引用 `references/` 下的文档路径。

### 编写要点

| 要点 | 说明 |
|------|------|
| 能力描述精确 | 一句话说清触发场景，方便 Agent 自动匹配 |
| 流程分步清晰 | 用编号列表，每步包含工具调用和检查点 |
| 示例真实可用 | 贴用户可能的提问和预期响应 |
| 避免过长 | 单文件 500 行以内，超过拆分到 references/ |
| YAML frontmatter | 可选；`POST /api/skills` 创建时模板会自动生成 frontmatter（`name` + `description`） |

## 与 MCP 的关系

| 维度 | Skill | MCP |
|------|-------|-----|
| 本质 | 知识/流程 Markdown | 工具服务器协议 |
| 存储 | `~/.ftre/skills/` + agent 私有 | `config.json` mcp 段 |
| 扩展方向 | 告诉 Agent 怎么做 | 给 Agent 新工具 |
| 加载时机 | 按需 / 自动匹配 | 启动时连接 |
| 热更新 | 改文件即可 | 改配置自动重连 |

## 校对记录

- **2026-08-08**：复验 Skill 系统实现。当前 `ftre/src/ftre/plugin/builtin/skill_plugin.py` 提供 4 类文件格式 `<name>.md` / `<name>/SKILL.md` / `<name>/skill.md`（`skill_plugin.py:421-425` 的 `_find_skill_file` 与 `:396-418` 的 `list_skill_descriptions`），与本文档"目录结构"表格一致；`loadSkill` 工具由 `create_load_skill_tool` 构造（`skill_plugin.py:329-387`），搜索顺序先私有后全局（`skill_plugin.py:349-364`），与"加载顺序"一致；`BEFORE_AGENT_RUN` hook（`skill_plugin.py:49`）注入 `<skill_desc>` + `<skill_list>` 提示词（`skill_plugin.py:51-66`），合并全局 + 当前 agent 私有 skill（`skill_plugin.py:288-326`），与"私有 Skill 合并规则"一致；`disabled_skills` 全局值从 `config.json` 读取（`skill_plugin.py:68-84`），per-agent 由 `agent.config.json` 整体覆盖（`skill_plugin.py:91-104`），与本文档"整体替换"一致。
