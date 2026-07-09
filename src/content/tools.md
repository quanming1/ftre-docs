# 内置工具

ftre 内置 8 个工具，定义在 `src/ftre/tools/` 下。`build_default_tools()` 在 `agent_manager.create_agent()` 中被调用，按当前 Agent 配置构建 `ToolRegistry`，再由 `filter_tools()` 按 `tools.allow` / `tools.deny` 裁剪后传给 `ReActAgent`。

工具基类 `Tool`、注册表 `ToolRegistry` 和执行器 `ToolHandler` 在 `ftre-agent-core` 中定义。

---

## 架构总览

```
agent_manager.create_agent()
  │
  ├─ build_default_tools(channel_manager, tool_registry, llm_config)
  │     ├─ 注册 6 个核心工具：bash / read / write / edit / set_workspace / cron
  │     ├─ 有 channel_manager 时追加 task + send_message
  │     └─ 合并全局插件 tool_registry 的工具（MCP 工具 / loadSkill 等）
  │
  ├─ filter_tools(registry, profile.tools_config)
  │     └─ 按 allow/deny 原地裁剪
  │
  └─ ReActAgent(tool_registry=registry)
        │
        react_runner._stream_turn()
          │
          LLM 返回 tool_calls
          │
          ToolHandler.spawn() ──→ asyncio.create_task(run_one())
          │                         │
          │                         ├─ _run_before(middleware)
          │                         ├─ _resolve_injections(runtime_context)
          │                         ├─ tool.execute() 或 await tool.func()
          │                         └─ _run_after(middleware)
          │
          ToolHandler.gather_results()
          │
          └─ tool_result_event(metadata=result.metadata)
```

---

## Tool 基类（ftre-agent-core）

| 属性 | 说明 |
|------|------|
| `name` | 工具名，LLM function calling 时使用 |
| `description` | 工具描述，作为 prompt 暴露给 LLM |
| `parameters` | `list[ToolParameter]`，自动转 OpenAI function schema |
| `func` | 可调用对象（`@tool()` 装饰器或手动传入） |

三种定义方式：

1. `@tool()` 装饰普通函数 — 参数自动从签名推断
2. `Tool(name=..., description=..., parameters=..., func=...)` — 手动构造
3. 继承 `Tool` 并实现 `_run()` — 适合有状态的复杂工具

`to_openai_dict()` 把 `parameters` 转成 OpenAI function calling 的 JSON schema，传给 LLM。

### Injected 依赖注入

函数签名中 `param: T = Injected("key")` 标记的参数**不暴露给 LLM**，运行时从 `runtime_context` 字典注入。常见注入键：

| key | 类型 | 说明 |
|-----|------|------|
| `workspace` | `WorkspaceAccessor` | 读写当前 session 的持久化 cwd |
| `llm_config` | LLM 配置 | 当前模型配置（vision 等） |
| `channel_id` | `str` | 调用方的 channel ID |
| `session_id` | `str` | 调用方的 session ID |
| `event_loop` | `asyncio.AbstractEventLoop` | 主事件循环引用 |
| `session_manager` | `SessionManager` | 会话管理器 |
| `agent_loop` | `AgentLoop` | Agent 循环单例 |
| `bus` | `EventBus` | 消息中枢 |

`ToolRegistry._parse_injections()` 在注册时扫描函数签名，记录 `param_name → inject_key` 映射。执行时 `_resolve_injections()` 从 `runtime_context` 取值填入 kwargs。

---

## ToolRegistry

工具注册表，提供注册 / 查找 / 执行 / 导出能力。

| 方法 | 说明 |
|------|------|
| `register(tool)` | 注册工具，同时解析其 Injected 参数 |
| `unregister(name)` | 注销工具 |
| `get(name)` / `has(name)` | 查找工具 |
| `execute(name, runtime_context, **kwargs)` | 同步执行（解析注入后调 `tool.execute()`） |
| `to_openai_tools()` | 导出所有工具的 OpenAI schema 列表 |
| `snapshot()` | 返回当前工具列表的快照（按注册顺序） |
| `add_middleware(mw)` | 注册工具中间件 |

### 工具中间件

`ToolMiddleware` 接口，提供 `before(ctx)` / `after(ctx, result)` 两个钩子。`before` 可调 `ctx.skip(result)` 跳过工具执行。中间件在 `ToolHandler.run_one()` 中按注册顺序执行。

当前无已注册的内置中间件。

---

## ToolHandler（ftre-agent-core）

工具执行器，负责单个工具的执行、并发调度和结果归并。

### run_one()

执行单个工具调用，返回 `ToolResult`。支持三种返回值类型：

| 返回类型 | 处理方式 |
|----------|----------|
| `str` | 直接作为 result |
| `AgentEvent`（如 `UserMessageEvent`） | result 为空，event 字段设为该事件（react_runner 后续注入 memory） |
| `tuple[str, dict]` | 拆分为 `result=result_str, metadata=dict`（edit/write 返回 diff metadata） |

异步工具（`is_async() == True`）直接 `await` 底层协程；同步工具通过 `asyncio.to_thread()` 在线程池执行，不阻塞主事件循环。

### 并发调度

LLM 一次返回多个 tool_calls 时，`spawn()` 为每个调用创建 `asyncio.create_task`，不阻塞 LLM 流消费。`gather_results()` 等待全部完成后按原始顺序归并结果。取消时 `drain()` 清理所有未完成任务。

### ToolResult

| 字段 | 说明 |
|------|------|
| `call_id` | 工具调用 ID |
| `name` | 工具名 |
| `result` | 结果文本（写入 memory 的 `role="tool"` 消息） |
| `error` | 错误信息 |
| `status` | `completed` / `failed` / `cancelled` |
| `metadata` | 工具返回的元数据（diff 信息等），透传到 `tool_result_event` |
| `event` | 工具返回的 `AgentEvent`，react_runner 后续注入 memory |

---

## WorkspaceAccessor

工具通过 `Injected("workspace")` 获取 `WorkspaceAccessor` 实例，它是对 session DB 中 `workspace` 字段的同步读写外观：

| 方法 | 说明 |
|------|------|
| `get()` | 返回当前 session 的 cwd；DB 中为空或路径不存在时回退 `fallback_cwd` |
| `set(path)` | 写入 DB，返回旧值 |

内部通过 `asyncio.run_coroutine_threadsafe()` 把异步 DB 操作抛回主事件循环执行。所有工具共享同一个 `WorkspaceAccessor` 实例（per-session），`set_workspace` 和 `bash` 的纯 `cd` 切换后，`read` / `write` / `edit` 立即看到新值。

---

## 内置工具列表

### 1. bash — 执行 shell 命令

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `command` | string | 是 | 要执行的 shell 命令 |
| `timeout` | number | 否 | 超时秒数，默认 60s，上限 600s |

**工作原理：**

1. **纯 cd 拦截**：检测到纯 `cd` 命令（不含 `&&` / `||` / `;` / `|` 等 shell 操作符）时，直接调 `ws.set()` 持久切换工作区，不走 subprocess
2. **RTK 重写**：检测到 `rtk` 已安装时，自动调用 `rtk rewrite` 将命令重写为 token 优化版本（如 `git status` → `rtk git status`），减少 60-90% 输出 token
3. **subprocess 执行**：`shell=True`，Windows 走 `cmd /c`，POSIX 走 `/bin/bash -c`；用 `CREATE_NEW_PROCESS_GROUP`（Windows）或 `start_new_session`（POSIX）创建独立进程组，便于超时时杀整个进程树
4. **输出处理**：Windows 优先 GBK 解码再退 UTF-8，其他平台 UTF-8；输出包裹在 `<FTRE_SYSTEM_FACT>` 标签中（含 `[cwd]` 行）；超过 20000 字符截断（保留头尾）

**semble 集成**：检测到 `semble` CLI 已安装时，在 description 中追加使用建议，引导 Agent 优先用语义代码检索而非 grep+read。

### 2. read — 读取文件 / 图片 / 目录

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件 / 图片 / 目录路径（支持绝对路径、相对工作区路径、HTTP(S) URL） |
| `start_line` | number | 否 | 起始行号（1-indexed），0 表示从头 |
| `end_line` | number | 否 | 结束行号（1-indexed，闭区间），0 表示到末尾 |

**三种分支：**

| 分支 | 触发条件 | 返回值 |
|------|----------|--------|
| 图片 | 路径后缀为图片扩展名或 HTTP(S) URL，且未指定行范围，且模型支持 vision | `UserMessageEvent`（`hide=true`），图片落盘到 `~/.ftre/assets/images/`，事件中只携带路径 |
| 目录 | 路径是目录 | 目录条目列表（目录在前、文件在后，文件附带字节大小） |
| 文本 | 其他情况 | `tuple[str, dict]`：带行号的文本 + metadata 内容快照 |
| 错误 | 文件不存在 / 不是文件 / 过大 | `str`（错误提示，无 metadata） |

**编码自动检测**：按 `utf-8-sig` → `utf-8` → `gbk` → `cp936` → `shift-jis` → `latin-1` 顺序尝试解码，非 UTF-8 文件首行显示 `[encoding]` 提示。

**大文件保护**：超过 256KB 的文件未指定 `end_line` 时拒绝整读，强制分段。

**图片压缩**：超过 5MB 的图片自动压缩——先按 4096px 缩放 + JPEG quality 70 编码，仍超限再退到 2048px + quality 60。

### 3. write — 创建 / 覆盖文件

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件路径（绝对或相对工作区） |
| `content` | string | 是 | 文件完整内容 |

**行为：**
- 已存在文件：保留原 encoding 和换行风格（CRLF/LF），读出旧内容后覆盖写入
- 新文件：utf-8 + LF，父目录不存在自动创建
- 返回 `(result_str, diff_metadata)` 元组

### 4. edit — 修改已有文件

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件路径 |
| `new_str` | string | 是 | 替换后的新文本 |
| `old_str` | string | 否 | 字符串模式：要替换的原文（须唯一匹配） |
| `start_line` | number | 否 | 行号模式：起始行（>0 时启用行号模式） |
| `end_line` | number | 否 | 行号模式：结束行（0 表示只替换 start_line 单行） |

**两种模式：**

| 模式 | 触发条件 | 行为 |
|------|----------|------|
| 字符串模式 | 未给 `start_line`，给 `old_str` | `old_str` 须在文件中**唯一**匹配后替换；0 次匹配时提示是否缩进/空格不一致；多次匹配时列出行号要求加更多上下文 |
| 行号模式 | `start_line > 0` | 用 `new_str` 替换 `[start_line, end_line]` 闭区间整行；`new_str` 为空串等价于删除；行号语义与 read 一致 |

写回保留原 encoding 与换行风格。返回 `(result_str, diff_metadata)` 元组。

### 5. set_workspace — 切换工作区

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 目标目录（必须绝对路径，支持 `~` 和环境变量展开） |

直接写入 DB 的 `workspace` 字段，后续所有工具的相对路径基于新目录解析。与 `bash` 纯 `cd` 等效，但适合在长任务开始时一次性声明，避免 `cd` 来回切换。

### 6. cron — 定时任务管理

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | 是 | `create` / `list` / `delete` / `update` |
| `cron` | string | create 时必填 / update 时可选 | cron 表达式（如 `*/5 * * * *`） |
| `prompt` | string | create 时必填 / update 时可选 | 触发时投递给 Agent 的提示词 |
| `title` | string | 否 | 任务标题（create/update 时可选；其他 action 忽略） |
| `job_id` | string | delete/update 时必填 | 任务 ID |
| `disabled` | boolean | 否 | `true` 时调度器跳过该任务（保留任务定义和历史，可随时启用）；`create` / `update` 均可设置 |

任务存储在 `~/.ftre/cron/<job_id>.json`。`CronScheduler` 每 30 秒扫描目录，对到期任务生成 `user_message` 投递到独立 cron session 中执行。`CronChannel` 是静默通道，outbound 不推送，但 `ChannelManager` 会将 `to_channel="cron"` 的 outbound 镜像到 ws channel，已 attach 的前端可收到事件。

### 7. task — 派发子任务（subagent 模式）

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 派发给 subagent 的提示词（必须自包含） |
| `session_id` | string | 否 | 复用已有 session；留空则新建 |
| `working_dir` | string | 否 | subagent 工作区（绝对路径），留空继承调用者 |

**工作原理：**
1. 新建或复用 `channel="subagent"` 的 session
2. 在 `AgentLoop` 注册一次性 `Future`，注册完成后通过 `SubagentChannel.receive()` 投递消息
3. 阻塞等待 subagent 跑完（启动超时 30s，执行超时 600s），返回最后一条 AI 回复
4. 防递归：subagent channel 内禁止再调 `task`

prompt 中自动追加 subagent 前缀约束（禁止调 task/send_message/cron）。

### 8. send_message — 跨 session 消息

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `channel_id` | string | 是 | 目标频道 ID（如 `ws`） |
| `session_id` | string | 是 | 目标 session ID |
| `content` | string | 是 | 消息内容 |
| `kind` | string | 否 | `notify`（默认）/ `invoke` |

| kind | 行为 |
|------|------|
| `notify` | 写入 `external_message` 事件到目标 session 历史 + outbound 推送，目标运行不受影响 |
| `invoke` | 以 `user_message` 形式投递到目标 session 的 `Channel.receive()`，触发目标 agent 执行（fire-and-forget） |

subagent 内禁止调用。禁止发给当前 session 自己。

---

## 工具能力裁剪

`build_default_tools()` 根据当前模型配置决定注册哪些工具：

- **vision 裁剪**：不支持视觉的模型，`read` 工具的 description 不会声明图片读取能力，且运行时返回错误提示
- **channel_manager 裁剪**：无 `channel_manager` 时不注册 `task` 和 `send_message`
- **插件工具合并**：全局 `tool_registry` 中的工具（MCP 工具 / `loadSkill`）通过 `snapshot()` 合并进来
- **Agent 级裁剪**：`agent.config.json` 的 `tools.allow` / `tools.deny` 在 `filter_tools()` 中原地过滤

---

## Diff Metadata

`edit` 和 `write` 工具返回 `tuple[str, dict]`，`ToolHandler.run_one()` 自动拆分为 `ToolResult(result=result_str, metadata=dict)`。metadata 通过 `react_runner` 透传到 `tool_result_event`，前端用于展示文件变更。

`_diff.py` 中的 `build_diff_metadata()` 用 Python 标准库 `difflib.unified_diff()` 生成 diff，不依赖 git：

```python
{
    "file": "E:/project/src/main.py",   # 文件路径（正斜杠）
    "before": "修改前内容",              # 完整旧内容
    "after": "修改后内容",               # 完整新内容
    "diff": "--- ...\\n+++ ...\\n@@ ...",# unified diff 文本
    "additions": 3,                      # 新增行数
    "deletions": 1,                      # 删除行数
}
```

新旧内容完全一致时返回空 dict（不产生 metadata）。

### Read Metadata

`read` 工具文本分支返回 `tuple[str, dict]`，metadata 存储文件内容快照：

```python
{
    "file": "E:/project/src/main.py",   # 文件路径（正斜杠）
    "content": "完整文件内容",            # 读取时刻的文本快照（不含行号前缀）
    "start_line": 1,                     # 实际读取的起始行（1-indexed）
    "end_line": 30,                      # 实际读取的结束行
}
```

前端 Inspector 面板优先使用 metadata.content 渲染文件预览（不回读磁盘），保证展示的是读取那一刻的内容快照。目录列举和图片读取不返回 metadata。

---

## 前端展示

工具调用结果在前端 `InlineToolCallCard` 中渲染：

### 普通工具（bash / cron / task / send_message 等）

点击展开 inline 详情：参数 + 结果文本 + 错误信息（失败时）。bash 输出使用 `ExpandedDetail` 渲染（带语法高亮），read 走 `ReadDetail` 渲染（带图片预览）。

### 文件工具（read / edit / write）

三种交互模式：

| 状态 | 行为 |
|------|------|
| 成功完成 + 有 metadata | 点击整行打开右侧 Inspector 面板；messageList 中不展开 |
| 失败（error）或无 metadata | 回退 inline 展开/折叠，显示错误信息 |
| 执行中 | Loader2 spinner，行不可点击 |

**Inspector 面板打开逻辑：**

| 工具 | 打开的 Tab | 数据来源 |
|------|-----------|---------|
| `edit` / `write` | diff 预览 | `metadata.before` / `metadata.after` / `metadata.additions` / `metadata.deletions` |
| `read` | 文件预览 | `metadata.content` 内容快照 + `metadata.start_line` / `metadata.end_line` 跳转 |

`InspectorPanel` 的 `FilePreviewContent` 优先使用 `tab.content` 渲染（不回读磁盘），无 content 时走 `window.desktop.fs.readFile()` 从磁盘加载；`fileCache` 缓存已加载文件，切回已开 tab 秒切。

**edit 行展示：** 成功时行尾显示 `+N -M` 增删数（绿/红色），不再显示 Check 图标。整行 hover 仅改变文字颜色（`group-hover:text-t-primary`），无背景色。

### Inspector 面板宽度

| 常量 | 值 | 说明 |
|------|---|------|
| `INSPECTOR_WIDTH_MIN` | 280 | 拖拽下限 |
| `INSPECTOR_WIDTH_MAX` | 9999 | 上限无实际约束 |
| `INSPECTOR_WIDTH_DEFAULT` | 480 | 默认宽度 |

拖拽分隔条持久化到 `ftre-layout-state` localStorage。

---

## 编码与换行保真

`_io.py` 提供文件 IO 辅助，`read` / `write` / `edit` 共用：

| 函数 | 说明 |
|------|------|
| `read_text(path)` | 自动检测编码，返回 `TextFile(text, encoding, newline, had_bom)`；text 统一为 `\n` |
| `write_text_preserving(path, text, original)` | 按原文件的 encoding 和 newline 写回 |
| `write_text_new(path, text, encoding, newline)` | 创建新文件，默认 utf-8 + LF |

候选编码顺序：`utf-8-sig` → `utf-8` → `gbk` → `cp936` → `shift-jis` → `latin-1`。无 BOM 的 utf-8-sig 解码成功时校正为 `utf-8`，避免写回时误加 BOM。

---

## 输出截断

`_truncate.py` 提供 `truncate_output()`，防止工具返回值过长导致上下文爆炸。超过 20000 字符时保留头尾各约一半，中间插入截断提示。`bash` 和 `read` 工具使用。

---

## FTRE_SYSTEM_FACT 标签

`bash`、`read`、`write`、`edit`、`set_workspace` 的返回值中包裹 `<FTRE_SYSTEM_FACT>` 标签，标记为系统注入的可信事实（文件路径、编码、cwd 等）。系统 prompt 基座指示模型无条件信任这些标签内的内容。

---

## 校对记录

- **2026-07-08**：与 `ftre/src/ftre/tools/` 和 `ftre-agent-core/src/ftre_agent_core/tool/` 源码核对，首次创建。
  - 8 个内置工具（bash / read / write / edit / set_workspace / cron / task / send_message）与 `tools/__init__.py:build_default_tools()` 注册列表一致；
  - `Tool` 基类三种定义方式、`Injected` 依赖注入、`ToolRegistry` 接口与 `ftre-agent-core/tool/base.py` 和 `registry.py` 一致；
  - `ToolHandler.run_one()` 支持 `str` / `AgentEvent` / `tuple[str, dict]` 三种返回值，与 `tool_handler.py` 对应分支一致；
  - `WorkspaceAccessor.get()/set()` 通过 `run_coroutine_threadsafe` 同步读写 DB，与 `_workspace.py` 一致；
  - `edit` / `write` 返回 `(result_str, diff_metadata)` 元组，`build_diff_metadata()` 用 `difflib.unified_diff` 生成 diff，与 `_diff.py` 和 `edit.py` / `write.py` 对应 return 行一致；
  - `bash` 的纯 cd 拦截、RTK 重写、semble 集成、平台提示与 `bash.py` 一致；
  - `read` 的三分支（图片/目录/文本）、编码检测、大文件保护、图片压缩与 `read.py` 一致；
  - `filter_tools()` 按 `allow/deny` 原地过滤，与 `__init__.py` 对应实现一致；
  - `react_runner` 在 `tool_result_event()` 中传入 `metadata=result.metadata`，与 `react_runner.py` 对应分支一致。
- **2026-07-08**：前端展示章节补充。
  - `InlineToolCallCard` 对 read/edit/write 的交互逻辑：成功 + 有 metadata → 点击整行打开 Inspector；失败/无 metadata → 回退 inline 展开。与 `InlineToolCallCard.tsx` 对应分支一致。
  - `InspectorTab.content` 字段：来自 `openFilePreview` 的第 5 参数（read metadata.content），`FilePreviewContent` 优先用 snapshotFile 渲染，与 `inspector.ts` 和 `InspectorPanel.tsx` 一致。
  - edit 行展示 `+N -M`（additions 绿色 / deletions 红色），不再用 Check 图标；hover 字体变色无背景色。与 `InlineToolCallCard.tsx` 对应渲染分支一致。
  - `INSPECTOR_WIDTH_MAX` 从 800 改为 9999，无实际上限，与 `layout.ts` 常量定义一致。
  - `read` 工具 metadata schema（file/content/start_line/end_line）与 `read.py` 对应 snapshot_meta 构造一致（之前误用 `content` 变量名，已修正为 `tf.text`）。
- **2026-07-08**：`build_default_tools()` 的调用位置从 `agent_manager._build_agent()` 修正为 `agent_manager.create_agent()`（源码中无 `_build_agent` 方法，`loop.py:510` 调用 `self.agent_manager.create_agent(...)`）。
- **2026-08-08**：复验 8 个内置工具与文档描述的一致性。
  - `bash`（`tools/bash.py`）：纯 cd 拦截（`workspace.set` 路径）、RTK 重写、subprocess 平台分支（Windows `cmd /c` / POSIX `/bin/bash -c`）、输出截断 20000 字符、输出包裹 `<FTRE_SYSTEM_FACT>` 标签，与本文档"工作原理"章节一致。
  - `read`（`tools/read.py`）：三分支（图片 / 目录 / 文本），编码检测顺序（`tools/_io.py`）、大文件保护 256KB、图片压缩阈值 5MB + 4096px 缩放（`read.py:19-20`），与文档"三分支"表格一致。
  - `write` / `edit`（`tools/write.py` / `tools/edit.py`）：保留原 encoding 和换行风格（CRLF/LF），返回 `(result_str, diff_metadata)` 元组，`build_diff_metadata` 用 `difflib.unified_diff`（`tools/_diff.py`），与文档"Diff Metadata"章节一致。
  - `set_workspace`（`tools/set_workspace.py`）：写入 session DB `workspace` 字段，与文档"set_workspace 切换工作区"一致。
  - `cron`（`tools/cron.py`）：工具支持 `create` / `list` / `delete` / `update` 四种 action（`cron.py:286-306` 的 update 分支），任务存储在 `~/.ftre/cron/<job_id>.json`，调度器 30 秒扫描一次（`cron.py:117`），与本文档"cron 工具"表格描述整体一致；`cron` 工具的 `ToolParameter` 定义（`cron.py:314-319`）含 `disabled` 字段（文档参数表第 236 行已声明），`enum=["create", "list", "delete", "update"]` 与文档第 230 行的 4 种 action 列表完全对齐；之前的 2026-07-22 校对记录中"参数表只列了 create / list / delete 三种 action（缺 update）"是当时文档未补全时的历史快照，本轮复核确认文档已与源码一致，无须再补充。
  - `task`（`tools/task.py`）：派发 subagent，30 秒启动超时 + 600 秒执行超时，subagent channel 内禁止再调 `task`；与文档"task 派发子任务"章节一致。
  - `send_message`（`tools/send_message.py`）：支持 `notify` / `invoke` 两种 kind，subagent 内禁止调用，禁止发给当前 session 自己；与文档"send_message 跨 session 消息"章节一致。
  - `ToolRegistry.register()` 仍为直接覆盖（`self._tools[name] = tool`），同名工具静默覆盖不抛 `ValueError`；`ToolHandler.run_one()` 仍支持 `str` / `AgentEvent` / `tuple[str, dict]` 三种返回值类型，与文档"ToolHandler"章节一致。
  - `WorkspaceAccessor.get()` / `set()` 仍通过 `asyncio.run_coroutine_threadsafe` 抛回主事件循环（`tools/_workspace.py`），与文档"WorkspaceAccessor"章节一致。
