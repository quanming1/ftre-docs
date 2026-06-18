# 本地插件

当前本地 `~/.ftre/plugins/` 目录下有 4 个插件。Gateway 启动时会扫描并加载该目录下所有非 `_` 开头的 `.py` 文件。

> **注意**：上下文压缩功能（原 `context_compact.py` 插件）已迁移为核心组件 `CompactHandler`（`ftre/agent/compact_handler.py`），不再作为插件存在。`/compact` 指令现已在 `AgentLoop._register_commands()` 中注册为普通指令。自动上下文管理采用 `precompact_threshold`(0.5) 单阈值：idle/usage 后台路径直接 `compact(enabled=true)`，用户输入路径在 `_step_compact` 中标记 `need_compact` 后在 `_run_async()` 中执行压缩。

---

## 1. title_gen — 自动生成会话标题

> ⚠️ 当前本地 `title_gen.py` 与现版 `ftre-agent-core` LLM API 不兼容，标题生成实际不可用；需修复插件后才可使用。后端核心配置里虽然已支持 `agents.defaults.title_generation`（会构造 `AgentConfig.title_llm`），但该本地插件目前无法正确调用它。

设计意图是在首条用户消息进入 `before_messages_build` 时异步调用 LLM 生成标题，写入 DB。后端不会为标题变更下发专用事件；前端在会话列表刷新后展示新标题。当前插件的 `_extract_text()` 从结构化 part 取文本时使用 `text` 字段（`part.get("text", "")`），而后端 `_text_value` 优先读取 `text`、兜底读取 `data`；桌面前端发送的结构化文本 part 使用 `text` 字段（`{ type: "text", text: "..." }`），因此 `_extract_text` 对前端发送的文本 part 可以正常取到文本。但 `_generate_title()` 方法存在两个 bug：（1）尝试从 `ftre_agent_core.llm` 导入 `LLMResponse` 和 `StreamDelta`，但当前 `ftre-agent-core` 不存在这两个类（只导出 `LLMHandler` / `TextDelta` / `ReasoningDelta` / `ToolInputDelta` / `ToolCall` / `StepFinish` 等），导致 `ImportError`；（2）`LLMHandler.stream()` 是 async generator（`async def stream`），而 `_generate_title()` 在同步 worker 线程中使用 `for item in handler.stream()` 尝试迭代，async generator 不支持同步 `for` 循环，会触发 `TypeError: 'async_generator' object is not iterable`。`ImportError` 先于 `TypeError` 发生，因此标题生成对所有内容类型都完全失效（`_spawn_title_generation` 的 worker 线程会捕获异常、记录日志后返回）。这是已知的代码 bug：`_generate_title` 应改用当前 `LLMHandler.stream()` 产出的 `TextDelta` 等事件类型，并使用 `asyncio.run()` 或 `loop.run_until_complete()` 包装 async generator 的迭代。

| 配置项 | 默认 | 说明 |
|--------|------|------|
| `system_prompt` | 内置 prompt | 标题生成的 system prompt |
| `input_truncate` | 1000 | 用户消息截断长度 |
| `max_chars` | 40 | 标题最大字符数 |

**触发条件：** events 为空（首次对话）+ session 无 title。

---

## 2. context_govern — 上下文治理

在 `before_messages_build` 阶段对事件流做四项修复 + AGENTS.md 注入。

### 修复能力

| 步骤 | 说明 |
|------|------|
| 孤立事件清理 | 丢弃没有配对 tool_call 的 tool_result，反之亦然 |
| tool_call 去重 | 同一 id 的 tool_call 只保留第一个（防止 DB 重复写入导致 `Duplicate tool_call_id`） |
| 相邻性修复 | 被 external_message 打断的 tool_call/tool_result 重新紧邻；同一 tool_call_id 的重复 tool_result 也会被去重丢弃 |
| 悬挂 tool_result | 压缩后 tool_call 被裁掉、tool_result 残留的丢弃 |

### AGENTS.md 注入

如果当前工作区下存在 `AGENTS.md`，将其内容以 `<AGENTS_RULE>` 标签注入 system_prompt 末尾：

```xml
<AGENTS_RULE desc="以下是用户在工作区自定义的规则与指令，你必须严格遵守" path="E:\project\AGENTS.md">
...文件内容...
</AGENTS_RULE>
```

---

## 3. skill — Skills 能力加载

扫描 `~/.ftre/skills/` 下的 Skill 文件（支持 `<name>.md`、`<name>/SKILL.md`、`<name>/skill.md`），注册 `loadSkill` 工具，并在 system_prompt 中注入 Skill 描述列表。

| 配置项 | 默认 | 说明 |
|--------|------|------|
| `skills_dir` | `~/.ftre/skills` | Skill 文件目录 |

**工作原理：**

- `setup()` 时注册 `loadSkill` 工具（Tool 类），Agent 可以调用它按需读取 Skill 完整内容
- `before_messages_build` 时扫描所有 Skill，提取名称和描述，以 `<skills>` 标签注入 system_prompt
- Agent 根据用户需求自主判断是否需要调用 `loadSkill`，同一个 Skill 只加载一次

---

## 4. hello — 示例插件

演示 Plugin 体系的基础能力——注册一个自定义 Channel。不做实际通信，启动时打印日志、收到 outbound 消息时打印日志。

文件名：`hello_plugin.py`

| 配置项 | 默认 | 说明 |
|--------|------|------|
| `greeting` | `Hello, ftre Plugin System!` | 启动时打印的问候语 |

```python
import logging
from ftre.plugin import Plugin
from ftre.channel import Channel
from ftre.bus import BusMessage

logger = logging.getLogger(__name__)

class HelloChannel(Channel):
    def __init__(self, bus, greeting: str = "Hello from Plugin!"):
        super().__init__(channel_id="hello", name="Hello Channel", bus=bus)
        self.greeting = greeting

    async def start(self) -> None:
        logger.info(f"[hello-channel] {self.greeting}")

    async def send(self, msg: BusMessage) -> None:
        logger.info(f"[hello-channel] 收到 outbound: {msg.type} → {msg.to_session}")

class HelloPlugin(Plugin):
    name = "hello"
    version = "0.1.0"

    def setup(self) -> None:
        greeting = self.api.config.get("greeting", "Hello, ftre Plugin System!")
        channel = HelloChannel(bus=self.api.bus, greeting=greeting)
        self.api.register_channel(channel)

    def teardown(self) -> None:
        logger.info("[hello-plugin] 已卸载")
```

---

## 通用约定

这些插件主要通过 `before_messages_build` hook 参与 Agent 生命周期；`hello` 只注册示例 Channel，不注册 hook。上下文压缩功能已从插件迁移为核心组件 `CompactHandler`，自动压缩水位检测在 AgentLoop Pipeline 的 `_step_compact` 阶段执行（仅标记 `need_compact`），真正的启用或压缩执行在 `_run_async()` 中（关键路径直接 `await`）；空闲后台压缩由 `_schedule_idle_compact` 使用 `asyncio.create_task()` 异步派发。hook 内抛异常会被捕获跳过，不会拖垮主流程。插件按 `Path.glob("*.py")` 返回顺序加载；同一 hook 点上的执行顺序就是注册顺序。
