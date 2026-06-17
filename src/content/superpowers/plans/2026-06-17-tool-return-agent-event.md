# Tool 返回 AgentEvent 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tool 可返回 `AgentEvent` 实例（不仅是 `str`），react_runner 检测后将其注入 memory 作为 user message，LLM 下一轮即可"看到"图片等多模态内容。

**Architecture:** 在 `AgentEvent` 新增 `UserMessageEvent` 子类。`ToolResult` 新增 `event` 字段。当 tool 返回非 `str` 的 `AgentEvent` 时，`tool_handler` 将其存入 `ToolResult.event`，`react_runner` 在写入 memory 阶段检测到 `event` 后跳过 `tool_result` 写入，改为追加 tool_result + `UserMessageEvent.to_openai_message()`。

**Tech Stack:** Python 3.12 dataclasses，`PIL`/`pillow`（`see_img` 工具图片压缩）

## Global Constraints

- 不修改 `ReActAgent` / `MemoryManager` 公共 API
- `to_dict()` / `from_dict()` 需支持 `UserMessageEvent`
- `tool_handler.py` 改动最小化（`ToolResult` 加一个字段）
- `see_img` 工具本地读取 + HTTP 下载，大图自动压缩
- metadata.hide=true 前端不渲染

---

## File Structure

| 文件 | 职责 | 操作 |
|------|------|------|
| `ftre-agent-core/src/.../agent/event.py` | 新增 `UserMessageEvent` + `EventType.USER_MESSAGE` | 修改 |
| `ftre-agent-core/src/.../agent/runner/tool_handler.py` | `ToolResult` 新增 `event` 字段；`run_one` 存 event | 修改 |
| `ftre-agent-core/src/.../agent/runner/react_runner.py` | Phase 5：检测 `result.event`，注入 memory | 修改 |
| `ftre/src/ftre/tools/see_img.py` | 新工具：本地/HTTP 图片 → base64 → `UserMessageEvent` | 创建 |
| `ftre/src/ftre/agent/loop.py` | `_PERSISTENT_CLASSES` 加入 `UserMessageEvent` | 修改 |
| `ftre/src/ftre/session/manager.py` | `to_openai_messages` 处理 `USER_MESSAGE` 类型 | 修改 |
| `binn/ftre-desktop/.../stores/chat.ts` | metadata.hide 跳过渲染 | 修改 |

---

### Task 1: 新增 UserMessageEvent（core/event.py）

**Files:**
- Modify: `E:\ftre-agent-core\src\ftre_agent_core\agent\event.py`

**Interfaces:**
- Produces: `UserMessageEvent` dataclass, `EventType.USER_MESSAGE`, `user_message_event()` 构造函数

- [ ] **Step 1: 添加 EventType.USER_MESSAGE**

在 `EventType` 枚举中新增：

```python
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
    USER_MESSAGE = "user_message"      # 新增
```

- [ ] **Step 2: 添加 UserMessageEvent 类**

```python
@dataclass
class UserMessageEvent(AgentEvent):
    """工具注入的 user message：LLM 可见，前端隐藏。
    
    Fields:
        content: str（文字）或 list[dict]（多模态，如 image_url）
        metadata: dict，默认 {"hide": True}
    """
    content: str | list[dict]
    metadata: dict[str, Any] = field(default_factory=lambda: {"hide": True})

    def __post_init__(self):
        object.__setattr__(self, 'type', EventType.USER_MESSAGE)

    def to_openai_message(self) -> dict:
        """转为 OpenAI 格式 user message，可直接追加到 memory。"""
        return {"role": "user", "content": self.content}

    def _data_dict(self) -> dict:
        return {"content": self.content, "metadata": self.metadata}
```

- [ ] **Step 3: 添加 user_message_event 构造函数 + _from_type 分支**

```python
def user_message_event(
    content: str | list[dict], metadata: dict[str, Any] | None = None
) -> UserMessageEvent:
    """构造 UserMessageEvent。hide=True 表示前端不渲染。"""
    return UserMessageEvent(
        content=content,
        metadata=metadata or {"hide": True},
    )

# _from_type 新增分支：
# if t == "user_message":
#     return UserMessageEvent(
#         content=data.get("content", ""),
#         metadata=data.get("metadata", {"hide": True}),
#     )
```

- [ ] **Step 4: 运行测试**

```bash
cd E:\ftre-agent-core && python -m pytest src/tests/test_simplify_verification.py -v -k "event" --tb=short
```
预期：全部通过（含新增 UserMessageEvent 测试）

- [ ] **Step 5: Commit**

```bash
git add src/ftre_agent_core/agent/event.py
git commit -m "feat: 新增 UserMessageEvent — tool 可注入 user message（LLM 可见/前端隐藏）"
```

---

### Task 2: ToolResult 新增 event 字段（core/tool_handler.py）

**Files:**
- Modify: `E:\ftre-agent-core\src\ftre_agent_core\agent\runner\tool_handler.py`

**Interfaces:**
- Consumes: `AgentEvent` from tool execution
- Produces: `ToolResult.event: AgentEvent | None`

- [ ] **Step 1: ToolResult 新增 event 字段**

```python
from ..event import AgentEvent   # 新增 import

@dataclass
class ToolResult:
    call_id: str
    name: str
    result: str
    error: str | None = None
    status: str = "completed"
    metadata: dict = field(default_factory=dict)
    event: AgentEvent | None = None   # 新增：工具返回的非 str 事件
```

- [ ] **Step 2: run_one 判断 raw 类型**

在 `run_one` 方法中（第 101 行附近），将 `result = ToolResult(call_id=call_id, name=name, result=str(raw))` 替换为：

```python
if isinstance(raw, AgentEvent):
    # 工具返回了 AgentEvent（如 UserMessageEvent），不转 str
    result = ToolResult(
        call_id=call_id, name=name,
        result="",   # result 字段留空（event 替代）
        event=raw,
    )
else:
    result = ToolResult(call_id=call_id, name=name, result=str(raw))
```

- [ ] **Step 3: 同样处理 async 分支**

```python
# 第 93 行
raw = await tool._get_callable()(**ctx.arguments)

# 改为：
raw = await tool._get_callable()(**ctx.arguments)
if isinstance(raw, AgentEvent):
    result = ToolResult(call_id=call_id, name=name, result="", event=raw)
    return self._run_after(ctx, result)
# 否则走原来的 str(raw) 逻辑
```

- [ ] **Step 4: 运行测试**

```bash
cd E:\ftre-agent-core && python -m pytest src/tests/test_tool_base.py src/tests/test_tool_registry.py -v --tb=short
```
预期：全部通过

- [ ] **Step 5: Commit**

```bash
git add src/ftre_agent_core/agent/runner/tool_handler.py
git commit -m "feat: ToolResult 新增 event 字段 — 支持工具返回 AgentEvent"
```

---

### Task 3: react_runner Phase 5 处理 ToolResult.event（core/react_runner.py）

**Files:**
- Modify: `E:\ftre-agent-core\src\ftre_agent_core\agent\runner\react_runner.py`

**Interfaces:**
- Consumes: `ToolResult.event: AgentEvent | None`
- Produces: memory 注入 + yield `UserMessageEvent`

- [ ] **Step 1: 修改 Phase 5 内存写入和事件产出**

在 `_stream_turn` 的 Phase 5（第 299-309 行），将现有循环替换为：

```python
events: list[AgentEvent] = []
for tc, result in zip(tool_calls, results):
    if result.event is not None:
        # 工具返回了 AgentEvent → 写入 tool_result + event 到 memory
        self.agent.memory.add_tool_result(
            tc.id,
            result.result or f"[{tc.name}] 已完成，见下条消息",
        )
        self.agent.memory.add_raw(result.event.to_openai_message())
        # yield tool_call + tool_result + event
        events.append(tool_call_event(
            id=tc.id, name=tc.name, arguments=tc.input or {},
        ))
        events.append(tool_result_event(
            id=result.call_id, name=result.name,
            result=result.result or f"[{tc.name}] 已完成",
            error=result.error, status=result.status,
        ))
        events.append(result.event)
    else:
        # 正常 str 路径
        self.agent.memory.add_tool_result(tc.id, result.result)
        events.append(tool_call_event(
            id=tc.id, name=tc.name, arguments=tc.input or {},
        ))
        events.append(tool_result_event(
            id=result.call_id, name=result.name,
            result=result.result, error=result.error,
            status=result.status,
        ))
```

- [ ] **Step 2: 运行测试**

```bash
cd E:\ftre-agent-core && python -m pytest src/tests/test_simplify_verification.py -v --tb=short -k "not test_agent and not test_cancel"
```
预期：全部通过

- [ ] **Step 3: Commit**

```bash
git add src/ftre_agent_core/agent/runner/react_runner.py
git commit -m "feat: react_runner 检测 ToolResult.event → 注入 memory 并 yield"
```

---

### Task 4: 创建 see_img 工具（ftre/tools/see_img.py）

**Files:**
- Create: `E:\ftre\src\ftre\tools\see_img.py`

**Interfaces:**
- Consumes: 本地绝对路径 或 HTTP URL
- Produces: `UserMessageEvent`（图片 base64）或 `str`（非图片文件）

- [ ] **Step 1: 创建 see_img.py**

```python
"""
see_img 工具 — 让 Agent 查看图片。

支持：本地绝对路径 | HTTP(S) URL
大图自动压缩（>5MB 或 >4096px → resize）
非图片文件 → 返回文本内容
"""
from __future__ import annotations

import base64
import io
import logging
import os
import urllib.request
from pathlib import Path

from ftre_agent_core.agent.event import UserMessageEvent, user_message_event
from ftre_agent_core.tool import Tool, ToolParameter

logger = logging.getLogger(__name__)

# ─── 压缩阈值 ──────────────────────────────────────────
MAX_FILE_SIZE = 5 * 1024 * 1024   # 5MB
MAX_DIMENSION = 4096              # 像素

def _load_image(src: str) -> tuple[bytes, str]:
    """读取图片并返回 (bytes, mime_type)。"""
    if src.startswith(("http://", "https://")):
        req = urllib.request.Request(src, headers={"User-Agent": "ftre-see-img"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        ct = resp.headers.get("Content-Type", "image/png")
        return data, ct
    
    path = Path(src)
    if not path.is_absolute():
        raise ValueError(f"see_img 需要绝对路径: {src}")
    if not path.exists():
        raise FileNotFoundError(f"文件不存在: {src}")
    
    # 判断 MIME
    ext = path.suffix.lower()
    mime_map = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
        ".svg": "image/svg+xml",
    }
    mime = mime_map.get(ext, "image/png")
    return path.read_bytes(), mime

def _compress(data: bytes, mime: str) -> tuple[bytes, str]:
    """图片太大时压缩：先按尺寸缩放，再按质量压缩。"""
    if len(data) <= MAX_FILE_SIZE:
        return data, mime
    
    from PIL import Image   # lazy import，非图片路径不依赖
    
    img = Image.open(io.BytesIO(data))
    w, h = img.size
    
    # 尺寸缩放
    if max(w, h) > MAX_DIMENSION:
        ratio = MAX_DIMENSION / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
    
    # JPEG 质量压缩
    buf = io.BytesIO()
    fmt = img.format or "JPEG"
    if fmt in ("JPEG", "WEBP"):
        img.save(buf, format=fmt, quality=70, optimize=True)
    else:
        img.save(buf, format=fmt, optimize=True)
    
    data2 = buf.getvalue()
    if len(data2) > MAX_FILE_SIZE:
        # 二次压缩：缩小到 2048
        w, h = img.size
        ratio = min(2048 / max(w, h), 1.0)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=60, optimize=True)
        data2 = buf.getvalue()
    
    mime2 = f"image/{fmt.lower()}"
    return data2, mime2

def _to_base64(data: bytes, mime: str) -> str:
    """转为 data URI。"""
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{b64}"

async def see_img(path: str) -> str | UserMessageEvent:
    """查看图片，返回 base64 编码的多模态 user message。
    
    参数:
        path: 本地绝对路径 或 HTTP(S) URL
    
    返回:
        图片文件 → UserMessageEvent（LLM 可见）
        非图片文件 → str（文件文本内容）
    """
    try:
        data, mime = _load_image(path)
    except Exception as e:
        return f"[see_img] 读取失败: {e}"
    
    # 检测是否图片
    if not mime.startswith("image/"):
        try:
            return data.decode("utf-8")[:10000]
        except UnicodeDecodeError:
            return f"[see_img] 非图片文件: {path} ({mime}, {len(data)} bytes)"
    
    # 压缩
    data, mime = _compress(data, mime)
    data_uri = _to_base64(data, mime)
    
    logger.info(f"[see_img] {path} → {mime}, {len(data)} bytes")
    
    return user_message_event(
        content=[{
            "type": "image_url",
            "image_url": {"url": data_uri},
        }],
        metadata={"hide": True, "path": path, "mime": mime, "size": len(data)},
    )


def create_see_img_tool() -> Tool:
    return Tool(
        name="see_img",
        description="查看图片（本地路径或 HTTP URL），返回 LLM 可识别的图片内容。大图自动压缩。非图片文件返回文本。",
        parameters=[
            ToolParameter(
                name="path",
                type="string",
                description="图片路径（本地绝对路径如 C:/photo.png 或 HTTP URL 如 https://example.com/img.jpg）",
                required=True,
            ),
        ],
        func=see_img,
    )
```

- [ ] **Step 2: 注册工具到默认工具集**

在 `E:\ftre\src\ftre\tools\__init__.py` 的 `build_default_tools` 中：

```python
from .see_img import create_see_img_tool

tools = [
    # ... existing tools ...
    create_see_img_tool(),
]
```

- [ ] **Step 3: 运行 test 验证 import**

```bash
cd E:\ftre && python -c "from ftre.tools.see_img import create_see_img_tool; t = create_see_img_tool(); print(f'{t.name}: {t.description[:50]}...')"
```
预期：`see_img: 查看图片（本地路径或 HTTP URL）...`

- [ ] **Step 4: Commit**

```bash
git add src/ftre/tools/see_img.py src/ftre/tools/__init__.py
git commit -m "feat: see_img 工具 — Agent 查看本地/HTTP 图片（base64 + 大图压缩）"
```

---

### Task 5: 更新 ftre 后端消费者

**Files:**
- Modify: `E:\ftre\src\ftre\agent\loop.py`
- Modify: `E:\ftre\src\ftre\session\manager.py`

**Interfaces:**
- Consumes: `UserMessageEvent` from agent
- Produces: DB 持久化 + Bus 发布 + to_openai_messages 处理

- [ ] **Step 1: loop.py 加入 _PERSISTENT_CLASSES**

```python
_PERSISTENT_CLASSES: tuple[type, ...] = (
    MessageCompleteEvent,
    ReasoningCompleteEvent,
    ToolCallEvent,
    ToolResultEvent,
    DoneEvent,
    UsageUpdateEvent,
    ErrorEvent,
    UserMessageEvent,    # 新增
)
```

- [ ] **Step 2: session/manager.py to_openai_messages 处理 USER_MESSAGE**

在 `to_openai_messages` 的循环中（`_t` 判断之后），新增分支：

```python
elif isinstance(_ae, UserMessageEvent):
    _flush_tool_calls()
    _take_reasoning()
    messages.append(_ae.to_openai_message())
```

- [ ] **Step 3: 运行测试**

```bash
cd E:\ftre && python -m pytest tests/test_mcp.py -v --tb=short
```
预期：19/19 通过

- [ ] **Step 4: Commit**

```bash
git add src/ftre/agent/loop.py src/ftre/session/manager.py
git commit -m "feat: loop.py + session 支持 UserMessageEvent 持久化和消息构建"
```

---

### Task 6: 前端隐藏 UserMessageEvent

**Files:**
- Modify: `E:\binn\ftre-desktop\packages\renderer\src\stores\chat.ts`

**Interfaces:**
- Consumes: WebSocket `agent_event` JSON
- Produces: 隐藏 metadata.hide=true 的消息

- [ ] **Step 1: 查 chat.ts 消息渲染逻辑**

在 message 处理 pipeline 中检测：

```ts
// 收到 agent_event 时
if (event.type === "user_message" && event.data?.metadata?.hide) {
    // 跳过渲染，不展示给用户
    // 但 token 用量仍需更新（如有 usage）
    return;
}
```

（前端按 JSON dict 消费 `event.type` / `event.data.metadata` 路径不变，仅新增 skip 逻辑。）

- [ ] **Step 2: Commit**

```bash
git add packages/renderer/src/stores/chat.ts
git commit -m "feat: 前端隐藏 metadata.hide=true 的 user_message"
```

---

### Task 7: 端到端验证

- [ ] **Step 1: 重启 Gateway**

```bash
cd E:\ftre && start.bat
```
确认无 import 报错，`see_img` 工具注册成功。

- [ ] **Step 2: 测试 see_img 本地图片**

发送消息："用 see_img 工具查看 E:\test.png"

预期：
- Agent 调用 see_img
- 返回 UserMessageEvent
- LLM 下一轮能看到图片并描述内容
- 前端不渲染 UserMessageEvent

- [ ] **Step 3: 测试 see_img HTTP 图片**

发送消息："用 see_img 查看 https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/300px-PNG_transparency_demonstration_1.png"

预期同上。

- [ ] **Step 4: 测试大图压缩**

发送消息，指定一张 >5MB 的大图。

预期：工具压缩后 ≤5MB，LLM 仍能识别。

- [ ] **Step 5: 测试非图片文件**

发送消息："用 see_img 查看 E:\test.txt"

预期：返回文本内容（str 路径），正常 tool_result 显示。

- [ ] **Step 6: Commit（如有修正）**

```bash
git add -A && git commit -m "fix: 端到端验证修复"
```