# Event Dict → Class 改造计划

> **历史计划**：本改造已落地。当前 `ftre-agent-core/src/ftre_agent_core/agent/event.py` 已使用 `@dataclass` 类体系，但实际子类为 12 个（含 `UserMessageEvent`、`AssistantMessageEvent`、`AssistantMessageCompleteEvent` 等），且 `message`/`message_complete` 已重命名为 `assistant_message`/`assistant_message_complete`。本文档保留为设计演化参考，具体实现请以当前源码为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `AgentEvent = dict` 改为 `@dataclass` 类体系，保持 JSON 序列化兼容。

**Architecture:** 8 个 `AgentEvent` 子类（每个现有 `EventType` 一个），带 `to_dict()` / `from_dict()` 桥接方法。BusMessage 和 DB 仍存 `{"type":"...", "data":{...}}` 格式不变。消费端从 `event.get("type")` 改为 `isinstance(event, XxxEvent)`。

**Tech Stack:** Python 3.12 `dataclasses` + TypeScript（前端仅加 interface，不强制改消费方式）

## Global Constraints

- 保持 WebSocket JSON 序列化格式 100% 兼容（`{"type": "...", "data": {...}}`）
- 保持 DB 存储格式兼容（stored_type + stored_data 列不变）
- 保持 `BusMessage.data` 的 JSON 兼容性
- 不改 `core` 的公共 API 签名（`agent.run()` 仍 yield 事件流）
- 无新第三方依赖

---

## File Structure

| 文件 | 职责 | 操作 |
|------|------|------|
| `ftre-agent-core/src/.../agent/event.py` | 定义所有 Event 类 + 构造函数 + to_dict/from_dict | **重写** |
| `ftre-agent-core/src/.../agent/runner/react_runner.py` | _stream_turn() yield 新 class 实例 | **修改** |
| `ftre-agent-core/src/.../agent/runner/tool_handler.py` | ToolResult + tool_handler 不变（不直接 yield 事件） | **不变** |
| `ftre-agent-core/src/.../agent/react.py` | ReActAgent.run() yield 事件 | **不变**（由 runner 处理） |
| `ftre/src/ftre/agent/loop.py` | _step_run() 消费事件：isinstance 替换 .get("type") | **修改** |
| `ftre/src/ftre/agent/compact_handler.py` | _serialize_events() 回放 DB 事件 | **修改** |
| `ftre/src/ftre/bus.py` | BusMessage 不变（data 接受 dict 或 class） | **不变** |
| `binn/ftre-desktop/.../stores/chat.ts` | usage_update 解析 | **修改** |

---

### Task 1: 定义 8 个 Event 子类（core/event.py）

**Files:**
- Modify: `E:\ftre-agent-core\src\ftre_agent_core\agent\event.py`

**Interfaces:**
- Produces: 8 个 `@dataclass` + `from_dict()` 工厂 + 8 个构造函数

- [ ] **Step 1: 定义基类 AgentEvent**

```python
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

class EventType(str, Enum):
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    MESSAGE = "message"
    MESSAGE_COMPLETE = "message_complete"
    REASONING = "reasoning"
    REASONING_COMPLETE = "reasoning_complete"
    ERROR = "error"
    RETRY = "retry"
    DONE = "done"
    TOOL_CALL_STREAMING = "tool_call_streaming"
    USAGE_UPDATE = "usage_update"

class DoneReason(str, Enum):
    COMPLETED = "completed"
    MAX_ITERATIONS = "max_iterations"
    ERROR = "error"
    CANCELLED = "cancelled"

@dataclass
class AgentEvent:
    type: EventType
    
    def to_dict(self) -> dict:
        """序列化为 {"type": ..., "data": {...}}"""
        return {"type": self.type.value, "data": self._data_dict()}
    
    def _data_dict(self) -> dict:
        """子类覆盖：返回 data 字段的内容"""
        return {}
    
    @classmethod
    def from_dict(cls, d: dict) -> "AgentEvent":
        """从 {"type": "...", "data": {...}} 反序列化"""
        t = d.get("type", "")
        data = d.get("data", {}) or {}
        return _from_type(t, data)

# 保留原有 AgentEvent 别名用于向后兼容的 TypeAlias
AgentEventDict = dict  # 暂时保留给未迁移的代码
```

- [ ] **Step 2: 定义 8 个子类**

```python
@dataclass
class ToolCallEvent(AgentEvent):
    tool_id: str
    tool_name: str
    arguments: dict[str, Any]
    
    def __post_init__(self):
        object.__setattr__(self, 'type', EventType.TOOL_CALL)
    
    def _data_dict(self) -> dict:
        return {"id": self.tool_id, "name": self.tool_name, "arguments": self.arguments}

@dataclass
class ToolResultEvent(AgentEvent):
    tool_id: str
    tool_name: str
    result: str
    error: str | None = None
    status: str = "completed"
    error_code: str | None = None
    metadata: dict[str, Any] | None = None
    
    def __post_init__(self):
        object.__setattr__(self, 'type', EventType.TOOL_RESULT)
    
    def _data_dict(self) -> dict:
        d = {"id": self.tool_id, "name": self.tool_name, "result": self.result,
             "error": self.error, "status": self.status, "error_code": self.error_code}
        if self.metadata:
            d["metadata"] = self.metadata
        return d

@dataclass
class MessageEvent(AgentEvent):
    content: str
    
    def __post_init__(self):
        object.__setattr__(self, 'type', EventType.MESSAGE)
    
    def _data_dict(self) -> dict:
        return {"content": self.content}

@dataclass  
class MessageCompleteEvent(AgentEvent):
    content: str
    
    def __post_init__(self):
        object.__setattr__(self, 'type', EventType.MESSAGE_COMPLETE)
    
    def _data_dict(self) -> dict:
        return {"content": self.content}

@dataclass
class ReasoningEvent(AgentEvent):
    content: str
    
    def __post_init__(self):
        object.__setattr__(self, 'type', EventType.REASONING)
    
    def _data_dict(self) -> dict:
        return {"content": self.content}

@dataclass
class ReasoningCompleteEvent(AgentEvent):
    content: str
    
    def __post_init__(self):
        object.__setattr__(self, 'type', EventType.REASONING_COMPLETE)
    
    def _data_dict(self) -> dict:
        return {"content": self.content}

@dataclass
class ErrorEvent(AgentEvent):
    message: str
    code: str = "unknown"
    
    def __post_init__(self):
        object.__setattr__(self, 'type', EventType.ERROR)
    
    def _data_dict(self) -> dict:
        return {"message": self.message, "code": self.code}

@dataclass
class RetryEvent(AgentEvent):
    code: str
    message: str
    attempt: int
    max_attempts: int
    
    def __post_init__(self):
        object.__setattr__(self, 'type', EventType.RETRY)
    
    def _data_dict(self) -> dict:
        return {"code": self.code, "message": self.message,
                "attempt": self.attempt, "max_attempts": self.max_attempts}

@dataclass
class DoneEvent(AgentEvent):
    success: bool
    reason: DoneReason
    usage: dict | None = None
    
    def __post_init__(self):
        object.__setattr__(self, 'type', EventType.DONE)
    
    def _data_dict(self) -> dict:
        d = {"success": self.success, "reason": self.reason.value}
        if self.usage:
            d["usage"] = self.usage
        return d

@dataclass
class ToolCallStreamingEvent(AgentEvent):
    tool_calls: list[dict]
    
    def __post_init__(self):
        object.__setattr__(self, 'type', EventType.TOOL_CALL_STREAMING)
    
    def _data_dict(self) -> dict:
        return {"tool_calls": self.tool_calls}

@dataclass
class UsageUpdateEvent(AgentEvent):
    usage: dict
    
    def __post_init__(self):
        object.__setattr__(self, 'type', EventType.USAGE_UPDATE)
    
    def _data_dict(self) -> dict:
        return {"usage": self.usage}
```

- [ ] **Step 3: 实现 `_from_type` 分发工厂**

```python
def _from_type(t: str, data: dict) -> AgentEvent:
    if t == "tool_call":
        return ToolCallEvent(tool_id=data.get("id", ""), tool_name=data.get("name", ""),
                             arguments=data.get("arguments", {}))
    if t == "tool_result":
        return ToolResultEvent(tool_id=data.get("id", ""), tool_name=data.get("name", ""),
                               result=data.get("result", ""), error=data.get("error"),
                               status=data.get("status", "completed"),
                               error_code=data.get("error_code"),
                               metadata=data.get("metadata"))
    if t == "message":
        return MessageEvent(content=data.get("content", ""))
    if t == "message_complete":
        return MessageCompleteEvent(content=data.get("content", ""))
    if t == "reasoning":
        return ReasoningEvent(content=data.get("content", ""))
    if t == "reasoning_complete":
        return ReasoningCompleteEvent(content=data.get("content", ""))
    if t == "error":
        return ErrorEvent(message=data.get("message", ""), code=data.get("code", "unknown"))
    if t == "retry":
        return RetryEvent(code=data.get("code", ""), message=data.get("message", ""),
                          attempt=data.get("attempt", 0), max_attempts=data.get("max_attempts", 0))
    if t == "done":
        reason_raw = data.get("reason", "completed")
        reason = DoneReason(reason_raw) if reason_raw in DoneReason.__members__ else DoneReason.COMPLETED
        return DoneEvent(success=data.get("success", False), reason=reason,
                         usage=data.get("usage"))
    if t == "tool_call_streaming":
        return ToolCallStreamingEvent(tool_calls=data.get("tool_calls", []))
    if t == "usage_update":
        return UsageUpdateEvent(usage=data.get("usage", {}))
    # fallback：未知类型，返回基类（保留 raw dict）
    return AgentEvent(type=EventType.ERROR)
```

- [ ] **Step 4: 更新构造函数——别名旧函数签名为新类构造**

```python
# 所有旧构造函数保留为工厂函数，内部直接调新 class
def tool_call_event(id: str, name: str, arguments: dict[str, Any]) -> ToolCallEvent:
    return ToolCallEvent(tool_id=id, tool_name=name, arguments=arguments)

def tool_result_event(id: str, name: str, result: str, error: str | None = None, *,
                       status: str = "completed", error_code: str | None = None,
                       metadata: dict[str, Any] | None = None) -> ToolResultEvent:
    return ToolResultEvent(tool_id=id, tool_name=name, result=result,
                           error=error, status=status, error_code=error_code,
                           metadata=metadata)

def message_event(content: str) -> MessageEvent:
    return MessageEvent(content=content)

def reasoning_event(content: str) -> ReasoningEvent:
    return ReasoningEvent(content=content)

def reasoning_complete_event(content: str) -> ReasoningCompleteEvent:
    return ReasoningCompleteEvent(content=content)

def message_complete_event(content: str) -> MessageCompleteEvent:
    return MessageCompleteEvent(content=content)

def done_event(success: bool, reason: DoneReason,
               usage: dict | None = None) -> DoneEvent:
    return DoneEvent(success=success, reason=reason, usage=usage)

def usage_update_event(usage: dict) -> UsageUpdateEvent:
    return UsageUpdateEvent(usage=usage)

def error_event(message: str, code: str = "unknown") -> ErrorEvent:
    return ErrorEvent(message=message, code=code)

def retry_event(code: str, message: str, attempt: int,
                max_attempts: int) -> RetryEvent:
    return RetryEvent(code=code, message=message, attempt=attempt,
                      max_attempts=max_attempts)

def tool_call_streaming_event(chunks: list) -> ToolCallStreamingEvent:
    # 保持原有 ToolCallDeltaChunk 转 dict 逻辑
    result = []
    for c in chunks:
        if isinstance(c, dict):
            entry = {k: v for k, v in c.items() if v is not None}
        else:
            entry = {k: v for k, v in {
                "index": c.index, "id": c.id, "name": c.name,
                "arguments_delta": c.arguments_delta,
            }.items() if v is not None}
        result.append(entry)
    return ToolCallStreamingEvent(tool_calls=result)
```

- [ ] **Step 5: 运行 core 测试确认**

Run: `python -m pytest src/tests/ -v`
Expected: 全部通过（构造函数签名不变）

- [ ] **Step 6: Commit**

```bash
git add src/ftre_agent_core/agent/event.py
git commit -m "feat: AgentEvent dict → @dataclass 类体系 (8 子类 + to_dict/from_dict)"
```

---

### Task 2: 更新 react_runner.py 消费者（core）

**Files:**
- Modify: `E:\ftre-agent-core\src\ftre_agent_core\agent\runner\react_runner.py`

**Interfaces:**
- Consumes: `event.py` 构造函数（签名不变，返回 class 实例）
- Produces: `AsyncGenerator[AgentEvent, None]`（类型更精确）

- [ ] **Step 1: 移除 dict 用法，改用 isinstance**

找到 react_runner.py 中唯一直接构造 dict 事件的地方（第 480-490 行的 done/error done 构造），改为 DoneEvent 构造：

```python
# Before:
done_evt = {"type": "done", "data": {"success": False, "reason": "cancelled"}}

# After:
done_evt = DoneEvent(success=False, reason=DoneReason.CANCELLED)
```

- [ ] **Step 2: 运行 core 测试确认兼容**

Run: `python -m pytest src/tests/ -v`
Expected: 全部通过

- [ ] **Step 3: Commit**

```bash
git add src/ftre_agent_core/agent/runner/react_runner.py
git commit -m "refactor: react_runner 使用 Event class 替代裸 dict"
```

---

### Task 3: 更新 ftre loop.py 消费者

**Files:**
- Modify: `E:\ftre\src\ftre\agent\loop.py`

**Interfaces:**
- Consumes: `AgentEvent` 实例（`agent.run()` 的 yield）
- Produces: `BusMessage(data=event.to_dict())` 或 `BusMessage(data=event)`

- [ ] **Step 1: 所有 `.get("type")` 改为 `isinstance`**

```python
# Before (line ~440):
if event.get("type") in self.PERSISTENT_EVENTS:
    await self.session_manager.save_message(
        session_id, event["type"], event.get("data", {}))
if event.get("type") == "usage_update" and ...:
    ...

# After:
from ftre_agent_core.agent.event import (
    UsageUpdateEvent, MessageCompleteEvent, ToolCallEvent, ...)

if isinstance(event, (MessageCompleteEvent, ToolCallEvent, ...)):
    await self.session_manager.save_message(
        session_id, event.type.value, event._data_dict())
if isinstance(event, UsageUpdateEvent) and ...:
    ...
```

- [ ] **Step 2: 手动构造的 done event 改为 class**

```python
# Before:
data={"type": "done", "data": {"success": False, "reason": "cancelled"}}

# After:
from ftre_agent_core.agent.event import DoneEvent, DoneReason
data=DoneEvent(success=False, reason=DoneReason.CANCELLED)
```

- [ ] **Step 3: BusMessage 序列化处理**

`BusMessage.data` 存 class 实例。在 `BusMessage.to_dict()` 或序列化处检测 `isinstance(event, AgentEvent)` 调 `event.to_dict()`：

```python
# 在 BusMessage 或 loop.py 的 publish_outbound 前
if isinstance(out.data, AgentEvent):
    out.data = out.data.to_dict()
```

或者保持 `BusMessage.data` 存 dict，loop.py 在赋值时调 `to_dict()`。选择后者（最小改动）：

```python
out = BusMessage(
    ...,
    data=event.to_dict(),  # class → dict for wire transport
)
```

- [ ] **Step 4: 回放 DB 历史时 from_dict**

```python
# Before: raw = {"type": db_type, "data": db_data}
# After:
from ftre_agent_core.agent.event import AgentEvent
raw_event = AgentEvent.from_dict({"type": db_type, "data": db_data})
```

- [ ] **Step 5: 运行 ftre 测试**

Run: `python -m pytest tests/ -v`
Expected: 全部通过

- [ ] **Step 6: Commit**

```bash
git add src/ftre/agent/loop.py
git commit -m "refactor: loop.py isinstance 替代 event.get('type') 字符串比较"
```

---

### Task 4: 更新 compact_handler.py 消费者

**Files:**
- Modify: `E:\ftre\src\ftre\agent\compact_handler.py`

**Interfaces:**
- Consumes: DB 回放的 dict 事件列表
- Produces: 压缩后的 LLM 摘要

- [ ] **Step 1: `_serialize_events` 中 dict 访问改为 class**

`_serialize_events` 遍历 `events: list[dict]`，用 `t = d.get("type")` 分支。改为用 `from_dict` 转 class 后访问属性：

```python
def _serialize_events(events: list[dict], ...) -> ...:
    # 新增：把 dict 统一转为 class 再处理
    from ftre_agent_core.agent.event import AgentEvent
    typed_events = [AgentEvent.from_dict(e) for e in events]
    
    for ev in typed_events:
        if isinstance(ev, MessageCompleteEvent):
            parts.append(f"[Assistant]: {ev.content}")
        elif isinstance(ev, ToolCallEvent):
            args_str = json.dumps(ev.arguments, ensure_ascii=False)
            parts.append(f"[Assistant tool call]: {ev.tool_name}({args_str})")
        # ...
```

- [ ] **Step 2: 其他辅助函数同理**

`get_previous_summary` / `get_pending_compact_index` / `_compact_enabled`——这些直接读 dict 的 context_compact 事件（非 AgentEvent），不需要改。

- [ ] **Step 3: 运行测试**

Run: `python -m pytest tests/ -v`
Expected: 全部通过

- [ ] **Step 4: Commit**

```bash
git add src/ftre/agent/compact_handler.py
git commit -m "refactor: compact_handler 使用 AgentEvent.from_dict 替代裸 dict 访问"
```

---

### Task 5: 更新前端 chat.ts

**Files:**
- Modify: `E:\binn\ftre-desktop\packages\renderer\src\stores\chat.ts`

**Interfaces:**
- Consumes: WebSocket JSON → 仍为 `{type, data}` 格式（兼容不变）
- Produces: `tokenUsage` store 更新

前端不受 class 改造影响——WebSocket 传输仍是 JSON dict。仅需确认 `usage_update` 处理无误。

- [ ] **Step 1: 确认 usage_update 解析逻辑不变**

检查 `chat.ts` 中 `event.type === "usage_update"` 逻辑是否依赖额外字段。当前实现：
```ts
if (event.type === "usage_update") {
    const usage = event.data?.usage;
    // 更新 tokenUsage store
}
```
**不变。** WebSocket 传的仍是 `{"type": "usage_update", "data": {"usage": {...}}}`。

- [ ] **Step 2: Commit（确认性）**

```bash
git add packages/renderer/src/stores/chat.ts
git commit -m "chore: 确认前端 usage_update 解析兼容 Event class 序列化"
```

---

### Task 6: 端到端验证

- [ ] **Step 1: 启动后端，发一条消息**

```bash
cd E:\ftre && start.bat
```
预期：Gateway 正常启动，`agent.run()` yield class 实例 → loop.py isinstance 消费 → Bus 发送 dict → 前端正常显示。

- [ ] **Step 2: 触发工具调用**

发送 "用 playwright 打开 example.com" 等含工具调用的消息。
预期：`ToolCallEvent` → `ToolResultEvent` 路径正常，前端看到工具调用动画。

- [ ] **Step 3: 触发 usage_update + compact**

发多轮消息直到触发 compact。
预期：`UsageUpdateEvent` 正常触发 `_schedule_idle_compact`，压缩摘要正常写入 DB。

- [ ] **Step 4: 检查 DB 回放**

重新连接客户端，加载历史 session。
预期：`from_dict(db_row)` 正确恢复 class 实例，回放消息不丢失。

- [ ] **Step 5: 检查 MCP 工具**

调用 `mcp__playwright__browser_navigate` 等 MCP 工具。
预期：工具调用事件路径不受影响。

- [ ] **Step 6: Commit**

```bash
# 如有修正：
git add -A && git commit -m "fix: 端到端验证修复"
```