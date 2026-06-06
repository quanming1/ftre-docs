# 插件系统

ftre 的插件系统允许你在不修改核心代码的前提下，扩展 Agent 的能力。

---

## 插件是什么

插件是一个 Python 类，继承 `Plugin` 基类，放在 `~/.ftre/plugins/` 目录下。Gateway 启动时自动扫描并加载。

一个插件可以：

- **注册 Tool** — 给 Agent 添加新的工具
- **注册 Channel** — 添加新的输入/输出通道
- **注册 Hook** — 在 Agent 生命周期中插入自定义逻辑
- **读取配置** — 从 `~/.ftre/config.json` 获取插件专属配置

---

## 运行位置

```
~/.ftre/
├── config.json          ← 在这里配置插件
└── plugins/
    └── my_plugin.py     ← 在这里写插件代码
```

---

## 配置方式

在 `~/.ftre/config.json` 中添加 `plugins` 数组：

```json
{
  "plugins": [
    {
      "name": "my_plugin",
      "config": {
        "api_key": "xxx",
        "timeout": 30
      }
    }
  ]
}
```

- `name` — 必须与插件的 `name` 属性匹配
- `config` — 任意 JSON 对象，插件通过 `self.api.config` 读取

注意：`plugins[]` 不是启用列表。Gateway 启动时会扫描并加载 `~/.ftre/plugins/` 下所有 `.py` 插件；`plugins[]` 只用于给同名插件传入配置。

---

## Plugin 基类

```python
from ftre.plugin import Plugin

class MyPlugin(Plugin):
    name: str = ""            # 必填，用于配置匹配
    version: str = "0.0.0"    # 版本号
    api: FtrePluginApi        # 框架注入

    def setup(self) -> None:
        """插件入口，在此注册能力。"""
        ...

    def teardown(self) -> None:
        """卸载时清理资源。"""
        ...
```

---

## FtrePluginApi

每个插件通过 `self.api` 访问框架能力：

| 属性 | 类型 | 说明 |
|------|------|------|
| `config` | dict | 插件专属配置（来自 config.json） |
| `bus` | EventBus | 消息总线 |
| `session_manager` | SessionManager | Session 和消息的持久化 |
| `channel_manager` | ChannelManager | Channel 注册和分发 |

### register_tool(tool)

注册一个 Tool 到 Agent 的默认工具集：

```python
from ftre_agent_core.tool import Tool, ToolParameter

tool = Tool(
    name="my_tool",
    description="一个示例工具",
    parameters=[
        ToolParameter(name="input", type="string", description="输入", required=True),
    ],
    func=lambda input: f"处理结果: {input}",
)
self.api.register_tool(tool)
```

### register_channel(channel)

注册一个新 Channel。需继承 `ftre.channel.Channel` 并实现 `send()`：

```python
from ftre.channel import Channel
from ftre.bus import BusMessage

class MyChannel(Channel):
    async def send(self, msg: BusMessage) -> None:
        pass  # 推送到外部

self.api.register_channel(MyChannel(bus=self.api.bus))
```

### register_hook(point, fn)

在生命周期挂点注册钩子。当前内置挂点只有 `before_messages_build`：

```python
from ftre.plugin import BEFORE_MESSAGES_BUILD

def my_hook(ctx):
    ctx.config.system_prompt += "\n\n额外提示词"
    return ctx

self.api.register_hook(BEFORE_MESSAGES_BUILD, my_hook)
```

---

## Hook 挂点

### before_messages_build

**触发时机：** 每次 Agent 执行前，在构建 LLM 输入消息时。

**上下文 `MessagesBuildContext`：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `session_id` | str | 当前会话 ID |
| `channel_id` | str | 来源 channel |
| `workspace` | str | 工作区绝对路径 |
| `events` | list | 事件流（可修改：裁剪/注入/重排） |
| `config` | AgentConfig | 配置副本（可改 system_prompt / model / llm 等） |
| `inbound_data` | dict | 当前用户消息的原始 data |
| `event_loop` | AbstractEventLoop | 当前事件循环 |

**使用示例：**

```python
def my_hook(ctx):
    # 修改 system_prompt
    ctx.config.system_prompt += "\n\n## 额外规则\n- 始终使用中文回复"

    # 过滤事件流
    ctx.events = [e for e in ctx.events if e.get("type") != "some_noise"]

    return ctx
```

### 自定义 Hook

可以通过 `HookManager.trigger()` 手动触发自定义挂点，供其他插件订阅。调用方式：

```python
from ftre.plugin import HookManager

hook_manager.trigger("my_custom_point", ctx)
```

---

## Tool 创建方式

### 手动构造

```python
Tool(
    name="bash",
    description="执行 shell 命令",
    parameters=[ToolParameter(name="command", type="string", description="要执行的命令")],
    func=run_bash,
)
```

### 装饰器

```python
from ftre_agent_core.tool import tool

@tool(name="hello", description="打个招呼")
def hello(name: str) -> str:
    return f"Hello, {name}!"
```

### 继承

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
| `type` | string | 是 | JSON Schema 类型 |
| `description` | string | 是 | 参数描述 |
| `required` | bool | 否 | 默认 `True` |
| `enum` | list | 否 | 可选值列表 |

### Injected 依赖注入

标记为 `Injected` 的参数不暴露给 LLM，由框架自动注入：

```python
from ftre_agent_core.tool import Injected

class MyTool(Tool):
    async def _run(self, event_loop=Injected("event_loop"), **kwargs):
        ...
```

---

## 禁止事项

- 文件名不要以 `_` 开头（会被跳过）
- 插件类必须继承 `Plugin`，设置非空 `name`
- `setup()` 必须实现
- hook 函数抛异常会被捕获跳过，不会拖垮主流程
- `Injected` 只能作为参数默认值使用（如 `x=Injected("x")`），不要写成类型注解
