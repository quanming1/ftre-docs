# 客户端：切换 Session 数据加载

本文详细说明桌面端（ftre-desktop）切换到一个 session 后，数据是如何拉取的。分 **6 种情况** 描述，每种情况给出完整时序和涉及的关键代码。

---

## 前置知识

### 三条数据来源

| 来源 | 触发方式 | 携带数据 | 用途 |
|------|---------|---------|------|
| HTTP REST | `GET /api/sessions/{id}/messages?limit_turns=5` | DB 已入库的稳定事件（`assistant_message_complete` / `tool_result` / `user_message` / `done` 等） | 首屏历史、翻页加载更早消息 |
| WS replay | `attach` 后服务端主动补发 | 当前正在流式的 `assistant_message` 快照（最多 1 条） | 补齐 HTTP 和 attach 之间正在输出的流式片段 |
| WS live | attach 后实时推送 | agent 实时产出的所有事件 | 流式渲染 |

### 事件去重

三条来源可能产出同一事件（例如 `assistant_message_complete` 既被 HTTP 返回又被 WS live 推送）。前端按以下优先级取 `event_id` 去重：

```
eventId → data.event_id → id（WS 帧 id）
```

去重后的 `eventId` 存入 bucket 的 `seenEventIds` Set，后续重复事件直接丢弃。

### WS 事件微批处理

chat store 在处理 WS 事件时使用 30ms 微批处理窗口：

- 流式事件（`assistant_message`）会被收集到 per-session 批次里，30ms 后一把 `applyEvent` + 一次 React 重渲染。
- 稳定事件（`tool_result` / `done` / `error` / `assistant_message_complete` 等）立即 flush 已有批次，然后单独处理。

**为什么需要这个**：replay buffer 下发的是原始流式 delta（可能几十条 `assistant_message`），如果逐条走 `applyEvent` + `mirror()`，React 会用 30+ 次 setState 重渲染，UI 看起来像打字机从零开始回放。微批处理后所有 delta 一次性消费到 bucket，最后一次重渲染时一次性刷新到当前状态。

---

## 情况 1：切换到空闲 Session

**场景**：Session 没有 agent 在运行，所有事件已入库。

```
用户从 Session B 切到 Session A（空闲）
│
├─ ① clearSessionCache(sessionId)
│    清空本地 bucket（messages / events / seenEventIds / hasMoreHistory）
│
├─ ② switchTo(sessionId)
│    chat store 记录 current sessionId，UI 进入 loading 状态
│
├─ ③ HTTP: GET /api/sessions/{sessionId}/messages?limit_turns=5
│    返回:
│    {
│      "messages": [...DB 已有记录...],
│      "has_more": true / false,
│      "status": "idle"              ← 后端 is_session_running() = false
│    }
│
├─ ④ loadSessionEvents(sessionId, historyToEvents(messages), "hydrate")
│    把 DB 历史记录转成 BusEvent[]，走 applyEvent 逐条重建 messages
│
├─ ⑤ prependSessionEvents(sessionId, [], page.hasMore)
│    设置 hasMoreHistory 标记（用于判断"还有没有更早的消息"）
│
├─ ⑥ setSessionStatus(sessionId, "idle")
│    UI: isBusy = false → 不显示 Running 横幅，发送按钮正常
│
└─ ⑦ wsClient.subscribeOnly(sessionId)
    后端 volatile replay buffer 为空（没有 agent 在跑）
    → 无 replay 帧下发
    → 此后也无 live 流
```

**结果**：UI 只展示 DB 历史消息，无横幅，按钮是"发送"。

**涉及代码**：
- `session.ts` → `switchSession()`（第 263-307 行）
- `chat.ts` → `loadSessionEvents()`、`prependSessionEvents()`、`setSessionStatus()`
- 后端 `routes.py` → `get_messages()`（返回 `status`）
- 后端 `loop.py` → `get_session_status()`（查 `_active_agents`）

---

## 情况 2：切换到正在流式的 Session（Agent 运行中）

**场景**：Session 的 agent 正在执行，产生了流式片段但尚未全部入库。

```
用户从 Session B 切回 Session A（Agent 正在流式）
│
├─ ① clearSessionCache(sessionId)
├─ ② switchTo(sessionId)
│
├─ ③ HTTP: GET /api/sessions/{sessionId}/messages?limit_turns=5
│    此时 DB 有:
│      user_message "读一下 main.py"
│      assistant_message_complete [text + toolCall: read]  ← 已完成并入库
│      tool_result read 的结果
│    但 agent 还在跑下一轮，当前轮的 assistant_message_complete 还没入库
│    返回:
│    {
│      "messages": [...DB 已有记录...],
│      "has_more": false,
│      "status": "running"           ← is_session_running() = true
│    }
│
├─ ④ loadSessionEvents → rebuild messages from DB history
├─ ⑤ prependSessionEvents → set hasMoreHistory
├─ ⑥ setSessionStatus(sessionId, "running")
│    UI: isBusy = true → 显示 Running... 横幅，按钮变暂停
│
└─ ⑦ wsClient.subscribeOnly(sessionId)
     → ws_channel._on_message("attach")
     → _volatile_replay.replay(session_id, ws)
        当前 buffer 里的内容（只有流式快照，最多 1 条）:
        [
          assistant_message  content=[{type:"text", text:"我来看看这个文件"}, {type:"toolCall", id:"call_2", name:"bash", arguments:"{\"comm"}]  ← 正在输出的累积快照
        ]
        全部补发给客户端
     → 客户端收到，逐条入 30ms 微批处理
        流式事件先收集到 per-session 批次，30ms 后一把 applyEvent + 一次 React 重渲染
        HTTP 已有的（按 event_id 去重命中）直接丢弃
        HTTP 没有的（流式片段）→ 一次性追加到现有 messages 尾部
      → 此后继续 live 流：
        assistant_message(content=[text+toolCall 累积]) → 替换当前消息的 parts/toolCalls
        assistant_message_complete(content=[完整], metadata) → 封口 assistant，写入 usage（已入库，HTTP 翻页时也能拉到）
        tool_result(...) → 更新 toolCall 状态（已入库）
        done → 清空 replay buffer，setSessionStatus("idle")
```

**关键点**：
- `setSessionStatus("running")` 在 HTTP 返回后立即设置，WS attach 前横幅就已经显示
- **volatile buffer 只缓存 `assistant_message`（流式快照）**：所有持久化事件（`assistant_message_complete` / `tool_result` / `user_message` / `done` 等）在 `loop.py` 中先入库后发 WS，不进 buffer。attach 时 buffer 最多只有 1 条当前正在输出的 `assistant_message`
- `assistant_message_complete` 到达时清除 buffer 中的 `assistant_message`（自己不进 buffer，因为已入库）
- `done` / `error` / `retry` 到达时整体清空 buffer
- **`tool_result` 跨来源匹配**：HTTP 加载的 `assistant_message_complete`（含 toolCall，status=running）和 WS live 推送的 `tool_result` 写入同一个 `b.messages` 数组。`tool_result` 通过 `data.id`（即 `call_xxx`）从后往前遍历 `b.messages` 找到匹配的 toolCall，更新 status 为 ok/error。无论 toolCall 来自 HTTP 历史还是 WS live，都能匹配
- replay 帧和 HTTP 已加载的帧可能重叠，靠 `event_id` 去重
- `assistant_message` 携带完整累积 content[]，前端 `buildFromContent()` 全量替换当前消息的 parts/toolCalls
- `ensure()` 只在尾部没有 streaming assistant 时创建新消息；已封口的消息不会被复用
- replay 帧走 30ms 微批处理：所有流式 delta 在窗口结束瞬间一次消费并渲染，UI 不会逐字回放

 **涉及代码**：
 - 后端 `ws_channel.py` → `_VolatileReplayBuffer.track()` / `replay()`
 - 前端 `chat.ts` → `applyEvent()`（第 233 行起）→ `ensure()` / `buildFromContent()` 全量替换流式内容
 - 前端 `chat.ts` → `seenEventIds` 去重（第 214-230 行）
 - 前端 `chat.ts` → `_enqueueWsEvent()` / `_flushWsBatch()`（30ms 微批处理）

---

## 情况 3：切换到运行中但没有历史消息的 Session

**场景**：Session 刚创建，用户发了第一条消息，agent 正在执行，但还没有任何事件入库。

```
用户发送第一条消息 → agent 开始执行
切换到另一个 Session 再切回来
│
├─ ① clearSessionCache(sessionId)
├─ ② switchTo(sessionId)
│
├─ ③ HTTP: GET /api/sessions/{sessionId}/messages?limit_turns=5
│    DB 里已有 user_message（已入库），但 LLM 还在流式输出第一轮响应
│    返回: { "messages": [user_message], "has_more": false, "status": "running" }
│
 ├─ ④ loadSessionEvents(_, [user_message], "hydrate")
  │    UI 显示用户消息，等待 agent 响应
  │
 └─ ⑤ wsClient.subscribeOnly(sessionId)
      后端 volatile replay buffer 有内容 → 补发:
      [
        assistant_message content=[{type:"text", text:"..."}]  ← 正在输出的流式快照
      ]
      全部补发 → 客户端逐条入 30ms 微批处理，30ms 后一把 applyEvent 追加到 messages 尾部
      → 此后继续 live 流直至 done
 ```

 **结果**：UI 显示用户消息 + 流式恢复 agent 响应。replay 帧一次性渲染到当前状态，无打字机回放。

 **涉及代码**：
 - `loadSessionEvents(messages=[user_message])` 从 HTTP 历史恢复用户消息
 - replay 帧只含 `assistant_message` 流式快照，走 `applyEvent` 追加到尾部

---

## 情况 4：切换到压缩中的 Session（Compacting）

**场景**：Session 正在执行 `/compact` 上下文压缩。

```
用户切到一个正在 compact 的 Session
│
├─ ① clearSessionCache(sessionId)
├─ ② switchTo(sessionId)
│
├─ ③ HTTP: GET /api/sessions/{sessionId}/messages?limit_turns=5
│    返回: { "messages": [...], "has_more": ..., "status": "compacting" }
│
├─ ④ loadSessionEvents → 重建历史消息
│    包括 context_compact 事件的 "压缩上下文中..." 气泡
│
├─ ⑤ setSessionStatus(sessionId, "compacting")
│    UI: isBusy = false
│        → 不显示 Running 横幅
│        → 发送按钮仍可使用
│        → compact 气泡在消息列表里独立渲染
│
└─ ⑥ wsClient.subscribeOnly(sessionId)
    后端此时 volatile replay buffer 已清空（compact 不在 buffer 里）
    → 无 replay 帧
    → compact 完成后 session_status 变为 idle/running
```

**结果**：UI 只显示历史消息 + compact 气泡，无 Running 横幅。

**关键点**：`sessionStatus === "compacting"` 不是 `isBusy`，不影响发送按钮。区分 compact 和 agent run 是三值状态的核心价值。

**涉及代码**：
- 后端 `loop.py` → `/compact` 的 session_status 发布（`compacting`）
- 前端 `ChatView.tsx` → 横幅只在 `sessionStatus === "running"` 时渲染
- 前端 `chat.ts` → `setSessionStatus()` → `isBusy = (status === "running")`

---

## 情况 5：加载更早消息（向上翻页）

**场景**：用户在消息列表顶部触发"加载更早消息"。

```
用户滚动到列表顶部
│
├─ loadEarlierMessages(sessionId)
│   ├─ ① 检查 hasMoreHistory(sessionId) → false 则直接返回
│   ├─ ② 取当前 bucket 最早事件的 timestamp:
│   │     getEarliestEventTs(sessionId)
│   │     从 messages/events/compactEvents 三者中取最小值
│   ├─ ③ HTTP: GET /api/sessions/{sessionId}/messages
│   │              ?limit_turns=5&before_ts=<earliestTs>
│   │     返回: { "messages": [...更早的事件...], "has_more": true/false }
│   ├─ ④ historyToEvents(page.messages) → BusEvent[]
│   └─ ⑤ prependSessionEvents(sessionId, events, page.hasMore)
│         把这些事件插入 bucket.messages 开头
│         更新 hasMoreHistory
│
└─ UI 自动渲染新增的历史消息
```

**关键点**：
- `before_ts` 作为 **游标**，只返回 `timestamp < before_ts` 的事件
- `limit_turns=5` 保证最少拉 5 轮对话
- 新拉的事件按时间正序插入到现有消息前面
- `event_id` 去重：如果更早的消息和当前 bucket 有重叠，`seenEventIds` 会丢弃重复

**涉及代码**：
- `session.ts` → `loadEarlierMessages()`（第 309-330 行）
- `chat.ts` → `prependSessionEvents()`、`getEarliestEventTs()`
- 后端 `manager.py` → `get_recent_messages_by_turns()`（支持 `before_ts`）

---

## 情况 6：断连重连

**场景**：WebSocket 断开后自动重连，恢复数据和流。

```
WebSocket 断开
│
├─ wsClient 自动重连
│   重连成功后:
│   ① 连接原 session 的 WebSocket
│   ② 检查 attachedSessions（之前订阅过的 session 列表）
│   ③ 对每个之前 attach 的 session:
│      ├─ 如果该 session 的 agent 仍在运行:
 │      │   后端 volatile replay buffer 有内容 → 补发
│      │   后续 live 流继续
│      └─ 如果 agent 已完成:
│           replay buffer 已清空 → 没有补发
│           但 DB 历史已经在前端 bucket 里（未清空）
│
└─ 用户无需手动刷新
```

**结果**：流式 session 自动恢复，已完成 session 保持原样。

---

## 总结对比

| 情况 | HTTP 返回 | WS replay | 横幅 | 按钮 |
|------|----------|-----------|------|------|
| 空闲 session | `status: "idle"` + messages | 无（buffer 空） | 无 | 发送 |
| 流式 session | `status: "running"` + 已入库的 messages | 有（当前流式快照，最多 1 条） | Running... | 暂停 |
| 流式空消息 session | `status: "running"` + user_message | 有（流式快照，最多 1 条） | Running... | 暂停 |
| 压缩中 session | `status: "compacting"` + messages | 无 | 无 | 发送 |
| 加载更早 | `has_more` + 更早 messages | 不走 WS | 不变 | 不变 |
| 断连重连 | 不触发 HTTP | 有（若 agent 仍在运行） | 不变 | 不变 |

核心原则：**HTTP 负责历史快照 + 状态初始化，WS replay 只补齐当前流式快照（最多 1 条 `assistant_message`），WS live 负责持续更新，event_id 统一去重。**
