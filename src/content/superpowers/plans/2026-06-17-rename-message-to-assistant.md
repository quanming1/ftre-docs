# Message/MessageComplete → AssistantMessage 重命名

> 不留兼容，不产生任何尾巴，数据库和前/后端同步执行。

**Goal:** `MessageEvent`/`MessageCompleteEvent` 重命名为 `AssistantMessageEvent`/`AssistantMessageCompleteEvent`，与 `UserMessageEvent` 对称。

**Scope:** wire format + class 名 + 构造函数 + DB 数据 + 前端 + 文档。

---

## 改名对照表

| 旧 | 新 |
|----|----|
| `EventType.MESSAGE = "message"` | `EventType.ASSISTANT_MESSAGE = "assistant_message"` |
| `EventType.MESSAGE_COMPLETE = "message_complete"` | `EventType.ASSISTANT_MESSAGE_COMPLETE = "assistant_message_complete"` |
| `MessageData` | `AssistantMessageData` |
| `MessageCompleteData` | `AssistantMessageCompleteData` |
| `MessageEvent` | `AssistantMessageEvent` |
| `MessageCompleteEvent` | `AssistantMessageCompleteEvent` |
| `message_event()` | `assistant_message_event()` |
| `message_complete_event()` | `assistant_message_complete_event()` |

DB wire format:
| 旧 | 新 |
| `"message"` | `"assistant_message"` |
| `"message_complete"` | `"assistant_message_complete"` |

---

## 影响文件 (共 13 个)

### Task 1: core event.py + __init__.py

- [ ] `event.py`: 重命名 EventType 值、类名、构造函数、_from_type 分支
- [ ] `__init__.py`: 更新导出

### Task 2: core react_runner.py

- [ ] 更新 import 和 yield 调用

### Task 3: core tests

- [ ] `test_simplify_verification.py`: 更新所有引用

### Task 4: ftre loop.py

- [ ] 更新 import + _PERSISTENT_CLASSES

### Task 5: ftre compact_handler.py

- [ ] 更新 import + isinstance 检查

### Task 6: ftre session/manager.py

- [ ] 更新 import + isinstance 检查

### Task 7: ftre tools/task.py

- [ ] 更新 import

### Task 8: ftre tests

- [ ] `test_compact_algo.py`: 更新 wire format 字符串

### Task 9: DB migration

- [ ] SQL: `UPDATE messages SET type = 'assistant_message' WHERE type = 'message'`
- [ ] SQL: `UPDATE messages SET type = 'assistant_message_complete' WHERE type = 'message_complete'`

### Task 10: docs

- [ ] `agent-events.md`: 更新所有引用

### Task 11: 测试验证

- [ ] core tests
- [ ] ftre tests
- [ ] 重启 Gateway 端到端测试
