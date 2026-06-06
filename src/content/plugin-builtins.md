# 内置插件

ftre 预装了 5 个内置插件，默认加载于 `~/.ftre/plugins/`。

---

## 1. title_gen — 自动生成会话标题

首条用户消息后异步调用 LLM 生成标题，写入 DB。前端轮询刷新即可展示。

| 配置项 | 默认 | 说明 |
|--------|------|------|
| `system_prompt` | 内置 prompt | 标题生成的 system prompt |
| `input_truncate` | 1000 | 用户消息截断长度 |
| `max_chars` | 40 | 标题最大字符数 |

**触发条件：** events 为空（首次对话）+ session 无 title。

---

## 2. context_govern — 上下文治理

在 `before_messages_build` 阶段对事件流做三项修复 + AGENTS.md 注入。

### 修复能力

| 步骤 | 说明 |
|------|------|
| 孤立事件清理 | 丢弃没有配对 tool_call 的 tool_result，反之亦然 |
| 相邻性修复 | 被 external_message 打断的 tool_call/tool_result 重新紧邻 |
| 悬挂 tool_result | 压缩后 tool_call 被裁掉、tool_result 残留的丢弃 |

### AGENTS.md 注入

如果当前工作区下存在 `AGENTS.md`，将其内容以 `<AGENTS_RULE>` 标签注入 system_prompt 末尾：

```xml
<AGENTS_RULE desc="以下是用户在工作区自定义的规则与指令，你必须严格遵守" path="E:\project\AGENTS.md">
...文件内容...
</AGENTS_RULE>
```

---

## 3. context_compact — 上下文压缩

当 token 水位超过阈值时，派发 subagent 对历史事件流做结构化摘要，写入 `context_compact` 事件。后续 `to_openai_messages` 遇到该事件会丢弃之前所有消息、以摘要为新起点。

| 配置项 | 默认 | 说明 |
|--------|------|------|
| `compact_threshold` | 0.8 | 触发阈值（实际 token / context_window） |
| `min_events` | 20 | 最少事件数才触发 |
| `timeout` | 300 | subagent 超时秒数 |

**流程：**

1. 检测水位 > threshold
2. 导出事件流为临时 JSON 文件
3. 新建 subagent session（继承工作区）
4. 投递压缩指令（告知 JSON 路径 + 输出格式要求）
5. 轮询等待 subagent 完成
6. 取最后一条 `message_complete` 作为摘要
7. 写 `context_compact` 事件 + 通知前端

**subagent 安全约束：** 只能读指定 JSON 文件；禁止写入、网络请求、安装包、启动服务；唯一产出是 markdown 摘要。

---

## 4. skill — Skills 能力加载

扫描 `~/.ftre/skills/` 下的 Skill 文件，注册 `loadSkill` 工具，并在 system_prompt 中注入 Skill 描述列表。

| 配置项 | 默认 | 说明 |
|--------|------|------|
| `skills_dir` | `~/.ftre/skills` | Skill 文件目录 |

**工作原理：**

- `setup()` 时注册 `loadSkill` 工具（Tool 类），Agent 可以调用它按需读取 Skill 完整内容
- `before_messages_build` 时扫描所有 Skill，提取名称和描述，以 `<skills>` 标签注入 system_prompt
- Agent 根据用户需求自主判断是否需要调用 `loadSkill`，同一个 Skill 只加载一次

---

## 5. hello — 示例插件

演示 Plugin 体系的基础能力——注册一个自定义 Channel。不做实际通信，启动时打印日志、收到 outbound 消息时打印日志。

```python
from ftre.plugin import Plugin
from ftre.channel import Channel

class HelloChannel(Channel):
    async def start(self):
        logger.info("Hello from Plugin!")

    async def send(self, msg):
        logger.info(f"收到: {msg.type}")

class HelloPlugin(Plugin):
    name = "hello"

    def setup(self):
        self.api.register_channel(HelloChannel(bus=self.api.bus))
```

---

## 通用约定

所有内置插件都通过 `before_messages_build` hook 参与 Agent 生命周期。hook 内抛异常会被捕获跳过，不会拖垮主流程。插件按加载顺序执行（文件名字典序）。
