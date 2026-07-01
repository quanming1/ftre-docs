# Octo Channel 插件

Octo Channel 是 ftre 的一个外部平台 Channel 插件，连接 [Octo IM](https://im.deepminer.com.cn) 即时通讯平台，让 ftre Agent 能够作为 bot 加入群聊、接收 @ 消息并自动回复。

独立仓库 `quanming1/ftre-octo-plugin`，本地路径 `~/.ftre/plugins/octo-plugin/`。

---

## 架构概览

```
Octo IM Server (WuKongIM 二进制协议)
        │
        │  wss://im.deepminer.com.cn/ws
        ▼
┌──────────────────────────┐
│  octo-bridge.js (Node)   │  ← WuKongIM 二进制协议解密 + JSON 转发
│  默认 ws://127.0.0.1:9876│     (可通过 bridge_port 配置)
└──────────┬───────────────┘
           │  JSON WebSocket
           ▼
┌──────────────────────────┐
│  _channel.py (Python)    │  ← OctoChannel: 消息收发、历史拉取、上下文注入
│  _api.py                 │  ← 通道常量 + external_key/session_id 编解码 + OctoBotApi
│  _mention.py             │  ← @ 检测门控（含广播抑制）+ 成员缓存
│  _tools.py               │  ← octo_management Tool
│  _plugin.py              │  ← OctoChannelPlugin: 入口 + Hook + 安全策略
│  octo_channel.py         │  ← 公开门面 re-export
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────────┐
│  ftre Gateway                │
│  PluginManager → ChannelMgr  │
│  AgentLoop → ReActAgent      │
└──────────────────────────────┘
```

---

## 文件结构

插件项目位于 `~/.ftre/plugins/octo-plugin/`，顶层 `~/.ftre/plugins/octo_channel.py` 是 shim 入口。

| 文件 | 职责 |
|------|------|
| `octo_channel.py` | 公开门面，re-export 所有公开符号 |
| `_api.py` | 通道类型常量 + `external_key` / fallback `session_id` 工具函数 + `extract_parent_group_no()` + `OctoBotApi` HTTP 客户端 |
| `_mention.py` | @ 检测门控（含广播抑制）+ 群成员缓存（5 分钟 TTL）与格式化 |
| `_channel.py` | `OctoChannel` 类：WS 连接管理、消息收发、历史消息 API 拉取与分段注入、`pending_context` 管理 |
| `_tools.py` | `octo_management` Agent 工具（4 个操作：list-groups / group-info / group-members / search-members） |
| `_plugin.py` | `OctoChannelPlugin` 入口：注册 Channel、`BEFORE_AGENT_RUN` hook、安全策略（当前临时 hardcode） |
| `octo-bridge.js` | Node.js WuKongIM 协议桥接：二进制解密 → 本地 JSON WS |

### Shim 加载机制

ftre 的 PluginManager 扫描 `~/.ftre/plugins/*.py`，只直接加载该目录下的 `.py` 文件。因此需要顶层的 `octo_channel.py` 作为 shim：

```python
# ~/.ftre/plugins/octo_channel.py
_PLUGIN_DIR = str(Path(__file__).resolve().parent / "octo-plugin")
if _PLUGIN_DIR not in sys.path:
    sys.path.insert(0, _PLUGIN_DIR)    # 保证内部模块间导入可用

_SPEC = importlib.util.spec_from_file_location("ftre_octo_plugin_project", _PLUGIN_FILE)
_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)

# 公开 re-export
OctoBotApi = _MODULE.OctoBotApi
OctoChannel = _MODULE.OctoChannel
OctoChannelPlugin = _MODULE.OctoChannelPlugin
create_octo_management_tool = _MODULE.create_octo_management_tool
```

shim 通过 `importlib.util` 在加载实际模块前将 `octo-plugin/` 加入 `sys.path`，解决了 `from _api import ...` 等内部导入问题。

---

## 核心功能

### @ 检测门控

三层检测策略，覆盖群聊（`type=2`）和讨论串（`type=5`）：

1. `uids` 字段直接 @bot uid → 触发
2. `ais=1`（@AI）→ 触发（但受广播抑制）
3. 文本内容正则匹配 `@ftre开发` → 兜底触发

#### 广播抑制

当 `all=1`（@所有人）或 `humans=1` 时，Octo 服务端会把 `ais` 也设为 `1`。为防止 @所有人 导致 bot 被刷屏触发，插件自动抑制此场景下的 `ais=1` 匹配。直接 @bot uid 不受抑制影响。

### 历史消息注入

每次被 @ 时，插件通过 `POST /v1/bot/messages/sync` 拉取最近消息，**不做内存缓存**（重启后首句 @ 即可看到历史）。

拉取后会先过滤：去掉 bot 自己的消息、当前触发消息、非文本消息、空内容消息。然后按 `_last_reply_seq` 分段：

```
[之前的消息 — 已经回答过，不要重复回答]
  ← seq ≤ last_reply_seq 的消息

[上次回复后的新消息 — 仅供参考，不要回答其中的问题]
  ← seq > last_reply_seq 且非当前消息

[当前消息 — 只回答这一条]
  ← 触发本次响应的那条消息
```

### 会话标识与持久映射

插件使用 ftre 的 `SessionManager.get_or_create_external_session()` 将 Octo 会话绑定到 ftre 内部 session，实现不同群聊/私聊的对话上下文持久隔离。

- **external_key** 格式：`octo:{channel_type}:{channel_id}`（私聊时 `channel_id` 为空则用 `from_uid`）
- **主路径**：通过 `external_sessions` 表映射到 ftre session（如 `octo::sess_xxx`），每次同群 @bot 复用同一 session
- **回退路径**：仅在 `session_manager` 不可用时，使用 `build_session_id()` 构造 `octo_{channel_type}_{channel_id}` 作为 session_id

映射在 `external_sessions` 表中持久化，重启后也生效。详见文档「架构设计」中 Session Manager 的 `external_sessions` 部分。

### 双轨上下文注入（对齐 OpenClaw）

上下文分两轨注入，对齐原始项目 `openclaw-channel-octo` 的 `prependContext` / `prependSystemContext`：

- **System Prompt 轨**：bot 身份信息（`<OCTO_IDENTITY>`），**PREPEND** 到已有 system 消息前
- **User 上下文轨**：成员列表 + 历史消息（`<OCTO_CONTEXT>`）+ 安全策略（`<OCTO_SAFETY>`），拼接到最后一条 user 消息前

注入点显式管理分隔符（`\n\n`），数据本身不带尾部换行。实现对齐 OpenClaw SDK：

```
preparedPrompt = prependContext + "\n\n" + preparedPrompt
```

### XML 标签包裹

参照 ftre 的 `<AGENTS_RULE>` / `<USER_CUSTOM_PROMPT>` 标签约定，所有插件的自动注入内容使用 XML 标签包裹：

| 标签 | 注入位置 | 内容 |
|------|---------|------|
| `<OCTO_IDENTITY>` | System prompt | bot 名称、ID、所在平台 |
| `<OCTO_CONTEXT>` | User 消息前缀 | 群成员列表 + 历史消息分段 |
| `<OCTO_SAFETY>` | User 消息前缀 | 安全策略（当前临时 hardcode） |

### Agent 管理工具

`octo_management` Tool 注册到 ftre 的 `tool_registry`，Agent 可主动调用：

| 操作 | API | 用途 |
|------|-----|------|
| `list-groups` | `GET /v1/bot/groups` | 列出 bot 加入的群 |
| `group-info` | `GET /v1/bot/groups/{groupNo}` | 查看群信息 |
| `group-members` | `GET /v1/bot/groups/{groupNo}/members` | 查看群成员 |
| `search-members` | `GET /v1/bot/space/members` | 搜索空间成员（keyword 参数） |

### 消息发送行为

- 只发送完整回复（`assistant_message_complete` 事件），不逐 token 流式输出到 Octo，避免大量碎片消息
- 空内容不发送（`if not content: return`）
- 每条 `sendMessage` 请求附带 `client_msg_no`（UUID v4），WuKongIM 服务端据此去重，防止网络重试导致重复消息

### 安全策略

当前安全策略为**临时实现**，hardcode 在 `_plugin.py` 的 `_on_agent_run()` 中：只响应特定用户（owner）的消息，非白名单发送者优雅拒绝回复。这不是通用 ACL 配置系统，后续计划迁移到可配置策略。

---

## 配置

在 `~/.ftre/config.json` 的 `plugins` 数组中：

```json
{
  "plugins": [
    {
      "name": "octo_channel",
      "config": {
        "bot_token": "bf_xxxxxxxxx",
        "api_url": "https://im.deepminer.com.cn/api",
        "bridge_port": 9876,
        "require_mention": true
      }
    }
  ]
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `bot_token` | string | 必填 | Octo Bot Token（`bf_` 开头） |
| `api_url` | string | 必填 | Octo HTTP API 地址 |
| `bridge_port` | int | 9876 | 桥接本地 WebSocket 端口 |
| `require_mention` | bool | true | 群聊中是否必须 @ 才回复。设为 false 则所有消息都回复 |
| `bot_id` | string | 自动获取 | bot 的 UID。可选预设值；未提供时插件会在 `register_bot()` 后从返回的 `robot_id` 自动获取 |
| `bot_name` | string | 同 bot_id | bot 名称，用于 @ 检测的文本兜底 |

---

## Octo API 速查

| 端点 | 方法 | 用途 |
|------|------|------|
| `/v1/bot/register` | POST | 注册 bot |
| `/v1/bot/sendMessage` | POST | 发送消息（驼峰命名），附带 `client_msg_no` |
| `/v1/bot/messages/sync` | POST | 获取频道历史（payload 为 base64 编码 JSON） |
| `/v1/bot/groups` | GET | 群列表 |
| `/v1/bot/groups/{groupNo}` | GET | 群信息 |
| `/v1/bot/groups/{groupNo}/members` | GET | 群成员 |
| `/v1/bot/space/members` | GET | 搜索空间成员 |

---

## 关键技术细节

### channel_type 枚举

| 值 | 类型 |
|----|------|
| 1 | 私聊（DM） |
| 2 | 群聊（Group） |
| 5 | 讨论串（Thread） |

Thread 的 `channel_id` 是复合格式 `groupNo____threadId`（4 个下划线），调 members API 需先用 `extract_parent_group_no()` 提取父群号。

### WuKongIM 协议桥接

Python 不直接处理 WuKongIM 二进制协议。Node.js 桥接（`octo-bridge.js`）负责：
- `Buffer → UTF-8 → base64 decode → AES decrypt` 解密 RECV 包
- 解密后通过本地 JSON WebSocket（默认 `ws://127.0.0.1:9876`）转发给 Python

### external_key 和 session_id 编解码

- `external_key`（API 调用/映射用）：`octo:{channel_type}:{channel_id}`，私聊时 `channel_id` 为空则用 `from_uid`
- 正常路径：通过 `SessionManager.get_or_create_external_session()` 映射到持久 ftre session
- 回退 `build_session_id()`：`octo_{channel_type}_{channel_id}`，仅在 `session_manager` 缺失时使用
- `parse_session_id()`：从 session_id 反向解析 `(channel_type, channel_id)`

### 成员缓存

群成员列表缓存在 `_mention.py` 内存中，TTL 5 分钟。缓存过期后下一条消息触发 API 刷新。刷新失败（如 bot 不在群里）不阻塞消息处理。

---

## 运行测试

```powershell
cd E:\ftre
$env:PYTHONPATH = "$env:USERPROFILE\.ftre\plugins\octo-plugin"
python -m pytest tests\test_octo_channel.py -v
```

## 代码检查

```powershell
cd $env:USERPROFILE\.ftre\plugins\octo-plugin
mypy --strict --ignore-missing-imports .
ruff check .
bandit -r . -ll
vulture . --min-confidence 80
```
