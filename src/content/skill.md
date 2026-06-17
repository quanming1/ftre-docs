# Skill 体系

Skill 是 ftre 的可复用能力模块——把工作流程、领域知识、工具用法沉淀成 Markdown 文件，Agent 按需加载到当前任务。

## 概述

| 特性 | 说明 |
|------|------|
| 存储位置 | `~/.ftre/skills/` |
| 文件格式 | `skill-name.md` 或 `skill-name/SKILL.md` |
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
- 目录形式：`~/.ftre/skills/<name>/SKILL.md`，可附带 `references/` 子目录存放扩展文档

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

## 内置 Skill

### frontend-design

创建高质量、生产级前端界面。触发场景：用户要求构建 Web 组件、页面或应用。

- 产出创意性强、风格鲜明的代码
- 避免通用 AI 美学风格
- 支持完整页面和独立组件

### mcp-guide

指导 MCP 配置、接入与排错。

- 解释 MCP 协议与 ftre 集成
- 配置 local stdio / remote HTTP 服务器
- 常见错误排查指南
- 推荐 MCP 服务器列表

### skill-creator

指导创建新的 Skill。

- Skill 文件规范
- 内容结构最佳实践
- 示例模板

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
| YAML frontmatter | 不支持，直接用 Markdown 标题 |

## 系统提示词注入

当前 Skill 的管理与读取能力由后端内置 API/工具提供：
- HTTP API 通过 `ftre/api/skill.py` + `ftre/api/routes.py` 读取 `~/.ftre/skills/`
- Agent 侧通过 `loadSkill` 工具按需读取完整内容

同时，当前后端源码中的注释仍明确约定：Skill 的描述会被插件注入到 system prompt，并提供 `loadSkill` 工具按需读取完整内容（见 `ftre/api/routes.py` 与 `ftre/api/skill.py` 中的说明）。因此可以确认的运行时设计是：
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
| 加载时机 | 按需 / 自动匹配 | 启动时连接 |
| 热更新 | 改文件即可 | 改配置自动重连 |