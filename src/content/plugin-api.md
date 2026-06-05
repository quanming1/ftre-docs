# Plugin API 参考

每个插件通过 `self.api` 访问 ftre 暴露的所有能力。`api` 的类型是 `FtrePluginApi`，在 `setup()` 调用前自动注入。

## Plugin 基类

```python
class Plugin:
    name: str = ""            # 插件名称（必填，用于配置匹配）
    version: str = "0.0.0"    # 版本号
    api: FtrePluginApi        # 由框架注入，setup() 之前就绪

    def setup(self) -> None:
        """插件入口，在此注册能力。"""
        raise NotImplementedError

    def teardown(self) -> None:
        """插件卸载时调用，做资源清理。"""
        pass
```

## FtrePluginApi

### 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `config` | dict | 来自 `~/.ftre/config.json` 的插件专属配置 |
| `bus` | EventBus | 消息总线，可发布/订阅 |
| `session_manager` | SessionManager | Session 和消息的持久化管理 |
| `channel_manager` | ChannelManager | Channel 注册和分发 |

### register_tool(tool)

注册一个 Tool，让它进入 Agent 的默认工具集。

```python
from ftre_agent_core.tool import Tool, ToolParameter

tool = Tool(
    name="my_tool",
    description="一个示例工具",
    parameters=[
        ToolParameter(name="input", type="string", description="输入参数", required=True),
    ],
    func=lambda input: f"处理结果: {input}",
)

self.api.register_tool(tool)
```

> `registerTool(tool)` 是 camelCase 别名，功能相同。

### register_channel(channel)

注册一个新 Channel。Channel 需要继承 `ftre.channel.Channel` 基类并实现 `send()`。

```python
from ftre.channel import Channel
from ftre.bus import BusMessage

class MyChannel(Channel):
    def __init__(self, bus):
        super().__init__(channel_id="my", name="My Channel", bus=bus)

    async def send(self, msg: BusMessage) -> None:
        # 将 outbound 消息推给外部
        pass

self.api.register_channel(MyChannel(self.api.bus))
```

### register_hook(point, fn)

在指定的生命周期挂点注册钩子函数。

```python
from ftre.plugin import BEFORE_MESSAGES_BUILD

def my_hook(ctx):
    # 修改 system_prompt
    ctx.config.system_prompt += "\n\n额外提示词"
    return ctx

self.api.register_hook(BEFORE_MESSAGES_BUILD, my_hook)
```

详细的 Hook 挂点和上下文定义见 [Hook 挂点与上下文](/docs/plugin-hooks)。

## Tool 创建方式

### 方式 1：手动构造

```python
Tool(
    name="bash",
    description="执行 shell 命令",
    parameters=[ToolParameter(name="command", type="string", description="要执行的命令")],
    func=run_bash,
)
```

### 方式 2：装饰器

```python
from ftre_agent_core.tool import tool

@tool(name="hello", description="打个招呼")
def hello(name: str) -> str:
    return f"Hello, {name}!"
```

### 方式 3：继承

```python
class MyTool(Tool):
    name = "my_tool"
    description = "我的工具"

    def _run(self, **kwargs):
        return "result"
```

### ToolParameter

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `name` | string | 是 | 参数名 |
| `type` | string | 是 | JSON Schema 类型：`"string"` / `"number"` / `"boolean"` / `"array"` / `"object"` |
| `description` | string | 是 | 参数描述 |
| `required` | bool | 否 | 是否必填，默认 `True` |
| `enum` | list | 否 | 可选值列表 |

### Injected 依赖注入

工具参数可以标记为 `Injected`，不暴露给 LLM，由框架自动注入：

```python
from ftre_agent_core.tool import Injected

class MyTool(Tool):
    async def _run(self, event_loop: Injected("event_loop"), **kwargs):
        # event_loop 由 ToolRegistry 从 runtime_context 中注入
        ...
```

## 内置插件参考

ftre 自带了几个参考插件，放在 `~/.ftre/plugins/` 下：

| 文件 | 名称 | 功能 |
|------|------|------|
| `skill_plugin.py` | skill | 加载 Skill 文件 + 注入 system prompt + 注册 loadSkill 工具 |
| `context_govern.py` | context | 对话历史裁剪、压缩、治理 |
| `context_compact.py` | compact | 上下文压缩（summary + 事件清理） |
| `title_gen.py` | title_gen | 自动生成会话标题 |
