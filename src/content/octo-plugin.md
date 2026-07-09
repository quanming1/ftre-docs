# Octo Channel 插件

Octo Channel 是 ftre 的一个外部平台 Channel 插件，连接 [Octo IM](https://im.deepminer.com.cn) 即时通讯平台，让 ftre Agent 能够作为 bot 加入群聊、接收 @ 消息并自动回复。

独立仓库 `quanming1/ftre-octo-plugin`，本地路径 `~/.ftre/plugins/octo_plugin/`。

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
│  _plugin.py              │  ← OctoChannelPlugin: 入口 + Hook + 私有工具注册
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

插件项目位于 `~/.ftre/plugins/octo_plugin/`，入口为 `__init__.py`。

| 文件 | 职责 |
|------|------|
| `__init__.py` | 插件入口，re-export `OctoChannelPlugin` |
| `_api.py` | 通道类型常量 + `external_key` / fallback `session_id` 工具函数 + `extract_parent_group_no()` + `OctoBotApi` HTTP 客户端 |
| `_mention.py` | @ 检测门控（含广播抑制）+ 群成员缓存（5 分钟 TTL）与格式化 |
| `_channel.py` | `OctoChannel` 类：WS 连接管理、消息收发、历史消息 API 拉取与分段注入 |
| `_tools.py` | `octo_management` Agent 工具（5 个操作：list-groups / group-info / group-members / search-members / fetch-history） |
| `_plugin.py` | `OctoChannelPlugin`：注册 Channel、`BEFORE_AGENT_RUN` hook、私有工具注册 |
| `octo-bridge.js` | Node.js WuKongIM 协议桥接：二进制解密 → 本地 JSON WS |

### 加载机制

ftre 的 PluginManager 扫描 `~/.ftre/plugins/` 下的子目录，每个子目录是一个 Python package。入口固定为 `__init__.py`：

```python
# ~/.ftre/plugins/octo_plugin/__init__.py
from _plugin import OctoChannelPlugin  # noqa: E402, F401

__all__ = ["OctoChannelPlugin"]
```

PluginManager 将子目录加入 `sys.path`，然后 `importlib.import_module(目录名)` 执行 `__init__.py`，从中找到 `Plugin` 子类自动实例化并加载。

---

## 核心功能

### @ 检测门控

三层检测策略，覆盖群聊（`type=2`）和讨论串（`type=5`）：

1. `uids` 字段直接 @bot uid → 触发
2. `ais=1`（@AI）→ 触发（但受广播抑制）
3. 文本内容正则匹配 `@<bot_name>`（即 `@<bot名称>`） → 兜底触发

> 兜底匹配的 `bot_name` 默认取 `bot_id`，可通过 `plugins[].config.bot_name` 显式配置。

#### 广播抑制

当 `all=1`（@所有人）或 `humans=1` 时，Octo 服务端会把 `ais` 也设为 `1`。为防止 @所有人 导致 bot 被刷屏触发，插件自动抑制此场景下的 `ais=1` 匹配。直接 @bot uid 不受抑制影响。

### 历史消息注入

每次被 @（群聊）或收到私聊消息时，插件通过 `POST /v1/bot/messages/sync` 拉取最近消息，**不做内存缓存**（重启后首句 @ 即可看到历史）。群聊和私聊都会拉取历史，补偿 agent 离线期间丢失的消息。

拉取后会先过滤：去掉 bot 自己的消息、当前触发消息、非文本消息、空内容消息。然后按 `_last_reply_seq` 分段：

```
[之前的消息 — 已经回答过，不要重复回答]
  ← seq ≤ last_reply_seq 的消息

[上次回复后的新消息 — 仅供参考，不要回答其中的问题]
  ← seq > last_reply_seq 且非当前消息

[当前消息 — 只回答这一条]
  ← 触发本次响应的那条消息
```

历史上下文使用 XML 标签包裹后拼接到用户消息 `content` 前缀，随消息持久化到 session DB。下一轮对话时 agent 从 DB 中读取历史上下文，无需插件临时注入。

### 会话标识与持久映射

插件使用 ftre 的 `SessionManager.get_or_create_external_session()` 将 Octo 会话绑定到 ftre 内部 session，实现不同群聊/私聊的对话上下文持久隔离。

- **external_key** 格式：`octo:{channel_type}:{channel_id}:{bot_id}`（私聊时 `channel_id` 为空则用 `from_uid`；`bot_id` 区分同一群内不同 bot 的 session）
- **主路径**：通过 `external_sessions` 表映射到 ftre session（如 `octo::sess_xxx`），每次同群 @bot 复用同一 session
- **回退路径**：仅在 `session_manager` 不可用时，使用 `build_session_id()` 构造 `octo_{channel_type}_{channel_id}_{bot_id}` 作为 session_id

映射在 `external_sessions` 表中持久化，重启后也生效。详见文档「架构设计」中 Session Manager 的 `external_sessions` 部分。

### 上下文注入

上下文分两轨注入，对齐原始项目 `openclaw-channel-octo` 的 `prependContext` / `prependSystemContext`：

- **System Prompt 轨**：bot 身份信息（`<OCTO_IDENTITY>`），在 `BEFORE_AGENT_RUN` hook 中 PREPEND 到已有 system 消息前
- **User 上下文轨**：群成员列表 + 历史消息 + 当前消息，在 `_handle_message` 中用 XML 标签包裹后拼接到 `content`，随用户消息持久化到 session DB

### XML 标签包裹

参照 ftre 的 `<AGENTS_RULE>` / `<USER_PROFILE>` 标签约定，所有插件的自动注入内容使用 XML 标签包裹：

| 标签 | 注入位置 | 内容 |
|------|---------|------|
| `<OCTO_IDENTITY>` | System prompt（hook 注入） | bot 名称、ID、所在平台 |
| `<OCTO_MEMBER_LIST>` | User 消息 content 前缀 | 群成员列表（仅群聊，用于 @ 人时查找 uid） |
| `<OCTO_HISTORY>` | User 消息 content 前缀 | 从 API 拉取的频道历史消息，按上次回复分段标注 |
| `<OCTO_CURRENT_MESSAGE>` | User 消息 content 前缀 | 当前需要回复的消息（发送者标签 + 原文） |

> 私聊无群成员列表，`<OCTO_MEMBER_LIST>` 标签省略；私聊发送者名称通过 `GET /v1/bot/user/info` API 获取。

### Agent 管理工具（per-agent 私有）

`octo_management` Tool 在 `BEFORE_AGENT_RUN` hook 中通过 `ctx.agent_tool_registry.register()` 注册为当前 agent 的私有工具，仅对 channel_id 为 `octo` 的 agent 生效。Agent 可主动调用：

| 操作 | API | 用途 |
|------|-----|------|
| `list-groups` | `GET /v1/bot/groups` | 列出 bot 加入的群 |
| `group-info` | `GET /v1/bot/groups/{groupNo}` | 查看群信息 |
| `group-members` | `GET /v1/bot/groups/{groupNo}/members` | 查看群成员 |
| `search-members` | `GET /v1/bot/space/members` | 搜索空间成员（keyword 参数） |
| `fetch-history` | `POST /v1/bot/messages/sync`（内部 `bot_api.get_channel_messages`） | 按需拉取当前频道的更多历史消息（参数：`limit` ≤ 200、`beforeSeq` 分页） |

### 消息发送行为

Channel 的 `send()` 方法只处理 `assistant_message_complete` 和 `done` 事件，不逐 token 流式输出到 Octo，避免大量碎片消息。基于 `assistant_message_complete` 事件的 `kind` 字段实现缓冲策略：

- `kind = "block"`（中间块，有工具调用）：缓冲到内存，**不立即发送**——避免提前发送"我先查看一下"之类的过渡文本
- `kind = "final"`（最终回复）：立即发送，清空缓冲
- `done` 事件：如果存在未发送的缓冲且本轮未发送过 final，则补发缓冲内容（防止 agent 异常终止时丢失回复）

发送时自动解析回复文本中的 @mention 格式：`@[uid:name]` → `@name` + 提取 uid 列表传入 `mention_uids` 参数，Octo 服务端据此触发被 @ 用户的通知。

其他细节：
- 空内容不发送
- 每条 `sendMessage` 请求附带 `client_msg_no`（UUID v4），WuKongIM 服务端据此去重，防止网络重试导致重复消息

---

## 配置

在 `~/.ftre/config.json` 的 `plugins` 数组中。支持多 bot：每个 bot 映射到不同的 Agent，同群内不同 bot 的 session 相互隔离。

```json
{
  "plugins": [
    {
      "name": "octo_channel",
      "enabled": true,
      "config": {
        "api_url": "https://im.deepminer.com.cn/api",
        "bots": [
          {
            "bot_token": "bf_xxxxxxxxx",
            "agent_id": "octo",
            "bot_name": "Octo"
          },
          {
            "bot_token": "bf_yyyyyyyyy",
            "agent_id": "exodia",
            "bot_name": "被封印的艾克佐迪亚"
          }
        ]
      }
    }
  ]
}
```

### 顶层配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `api_url` | string | 必填 | Octo HTTP API 地址 |
| `bots` | array | 必填 | Bot 列表，每个元素对应一个 Octo Bot |
| `bridge_port` | int | 9876 | 桥接本地 WebSocket 端口 |
| `require_mention` | bool | true | 群聊中是否必须 @ 才回复。设为 false 则所有消息都回复 |

### bots[] 元素

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `bot_token` | string | 必填 | Octo Bot Token（`bf_` 开头），同时作为 bot_id 标识 |
| `agent_id` | string | `"default"` | 该 bot 消息路由到的 Agent ID（对应 `~/.ftre/agents/<agent_id>/`） |
| `bot_name` | string | `"Bot"` | Bot 名称，用于 @ 检测的文本兜底匹配 |

### 多 bot session 隔离

同一群聊中如果有多个 bot，每个 bot 的 session 独立隔离，通过 `bot_id` 维度区分：

- **external_key** 格式：`octo:{channel_type}:{channel_id}:{bot_id}`
- **历史分段**：`record_bot_reply` 以 `channel_id:bot_id` 为 key 追踪 `last_reply_seq`
- **回复路由**：通过 `session → bot_id` 映射选择对应 bot 的 API 发送回复

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

#### 心跳消息过滤

WuKongIM 服务端会定期发送心跳消息（`type=99`、`from_uid` 为空、`message_seq=0`）。这些消息不是用户消息，不需要转发给 Python 处理。桥接层在解密后判断 `payloadObj.type === 99 && !fromUID`，直接 return——不转发、不记日志，但 RECVACK 照常发送给服务端以确认接收。

### external_key 和 session_id 编解码

- `external_key`（API 调用/映射用）：`octo:{channel_type}:{channel_id}:{bot_id}`，私聊时 `channel_id` 为空则用 `from_uid`
- 正常路径：通过 `SessionManager.get_or_create_external_session()` 映射到持久 ftre session
- 回退 `build_session_id()`：`octo_{channel_type}_{channel_id}_{bot_id}`，仅在 `session_manager` 缺失时使用
- `parse_session_id()`：从 session_id 反向解析 `(channel_type, channel_id, bot_id)`

### 成员缓存

群成员列表缓存在 `_mention.py` 内存中，TTL 5 分钟。缓存过期后下一条消息触发 API 刷新。刷新失败（如 bot 不在群里）不阻塞消息处理。

---

## 运行测试

```powershell
cd E:\ftre
$env:PYTHONPATH = "$env:USERPROFILE\.ftre\plugins\octo_plugin"
python -m pytest tests\test_octo_channel.py -v
```

## 代码检查

```powershell
cd $env:USERPROFILE\.ftre\plugins\octo_plugin
mypy --strict --ignore-missing-imports .
ruff check .
bandit -r . -ll
vulture . --min-confidence 80
```

## 校对记录

- **2026-08-08**：本文档描述 Octo Channel 插件的架构、@ 检测门控、历史消息注入、上下文注入（XML 标签）、Agent 管理工具、消息发送行为等。文档涉及的源码（`_channel.py` / `_api.py` / `_mention.py` / `_tools.py` / `_plugin.py`）位于独立仓库 `quanming1/ftre-octo-plugin`，本地路径 `~/.ftre/plugins/octo_plugin/`，与本文档"加载机制"一致；本仓库 `ftre-agent-core` / `ftre` / `ftre-desktop` 不直接引用 Octo 插件代码（仅在 `PluginManager` 通用加载路径中按子目录自动发现），因此本节描述无法直接对照本工作区源码核对；本文档主要面向 Octo 插件维护者，使用时应以其独立仓库的当前代码为准。
