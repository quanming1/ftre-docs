# Skill 体系

Skill 是 ftre 的可复用能力模块——把工作流程、领域知识、工具用法沉淀成 Markdown 文件，Agent 按需加载到当前任务。

## 概述

| 特性 | 说明 |
|------|------|
| 存储位置 | `~/.ftre/skills/` |
| 文件格式 | `skill-name.md`、`skill-name/SKILL.md` 或 `skill-name/skill.md` |
| 加载方式 | 用户点名 → Agent 调 `loadSkill` 读取，或 Agent 自动匹配 |
| 作用域 | 当前对话 session，不跨 session 污染 |

## 目录结构

```
~/.ftre/skills/
├── frontend-design.md          # 单文件 Skill
├── mcp-guide/
│   ├── SKILL.md                # Skill 主入口（必需）
│   └── references/
│       ├── servers.md          # 参考文档
│       └── troubleshooting.md  # 排错指南
└── skill-creator/
    └── SKILL.md
```

- 单文件：`~/.ftre/skills/<name>.md`
- 目录形式：`~/.ftre/skills/<name>/SKILL.md`（或 `<name>/skill.md`），可附带 `references/` 子目录存放扩展文档

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
| YAML frontmatter | 可选；`POST /api/skills` 创建时模板会自动生成 frontmatter（`name` + `description`），`extract_description()` 会优先从 frontmatter 读取描述；手写时也可以不用 frontmatter，直接用 Markdown 标题 |

## 系统提示词注入

当前 Skill 的管理与读取能力由后端内置插件/工具提供：
- HTTP API 通过内置 `skill` 插件（`plugin/builtin/skill_plugin.py`）注册 `/api/skills` CRUD 路由，底层文件 IO 由 `ftre/api/skill.py` 提供
- Agent 侧通过 `loadSkill` 工具按需读取完整内容

因此可以确认的运行时设计是：
- Skill 摘要会进入系统提示词，供 Agent 判断是否需要加载；
- Skill 正文在需要时通过 `loadSkill` 读取；
- 前端的 Skill 管理 UI 走的是同一套本地文件存储。

## 生命周期

```
Skill 文件保存在 ~/.ftre/skills/
  │
  ├─ 后端 API 可列出 / 读取 / 增删改这些文件
  └─ Agent 在需要时调用 loadSkill(name)
        │
        ├─ 读取完整正文
        ├─ 同一 Skill 在当前对话通常只加载一次
        └─ 按 Skill 内容指导后续执行
```

## 与 MCP 的关系

| 维度 | Skill | MCP |
|------|-------|-----|
| 本质 | 知识/流程 Markdown | 工具服务器协议 |
| 存储 | `~/.ftre/skills/` | `config.json` mcp 段 |
| 扩展方向 | 告诉 Agent 怎么做 | 给 Agent 新工具 |
| 加载时机 | 按需 / 自动匹配 | 启动时连接；配置文件或 API 变更可热重载 |
| 热更新 | 改文件即可 | 改配置自动重连 |

## 校对记录

- **2025-06-26**：与 `ftre/src/ftre/plugin/builtin/skill_plugin.py` / `ftre/src/ftre/api/skill.py` 核对，描述准确。
  - Skill 三种文件形式 `<name>.md` / `<name>/SKILL.md` / `<name>/skill.md` 与 `skill_plugin.py:267-271,332-336` 一致；
  - `loadSkill` 工具由 `skill_plugin.py:252-297` 中 `create_load_skill_tool(skills_dir, disabled_skills)` 创建并通过 `self.api.tool_registry.register(...)`（`skill_plugin.py:56`）注册到 Agent 工具集；
  - `<skill_list>` 标签注入 system_prompt 的实现见 `skill_plugin.py:237-248`；
  - HTTP API 路由（`/api/skills` 系列，包括 `GET /api/skills`、`GET /api/skills/{name}`、`POST /api/skills`、`PUT /api/skills/{name}`、`DELETE /api/skills/{name}`、`PATCH /api/skills/{name}/toggle`）由 `skill_plugin.py:73-...` 通过 `APIRouter(prefix="/skills")` 注册，最终路径为 `/api/skills*`；
  - `disabled_skills` 通过 `config.json` 的 `disabled_skills` 数组管理，`PATCH /api/skills/{name}/toggle` 切换；
  - YAML frontmatter：可选手写；`POST /api/skills` 创建时模板自动生成 `name` + `description`；`extract_description()` 优先从 frontmatter 读取；
  - 当前源码仓库只定义 Skill 插件、工具和 CRUD API，不包含固定的“内置 Skill”清单；可用 Skill 以运行时 `~/.ftre/skills/` 目录实际内容为准。