# 帧格式规范

## 通用帧结构

所有 WebSocket 帧遵循统一的外壳结构：

```json
{
  "id": "<uuid>",
  "type": "<type>",
  "data": { ... },
  "metadata": { ... }
}
```

## id 字段

- 客户端发送帧时生成唯一 `id`
- 后端将 `id` 回填到 echo 帧的 `metadata.frame_id`
- 前端用 `frame_id` 与本地乐观占位去重

## type 字段

### 上行（Client → Server）

| type | data.session_id | 说明 |
|------|:---:|------|
| `attach` | 必填 | 该 WebSocket 关注某个 session |
| `detach` | 必填 | 取消关注 |
| `user_input` | 必填 | 用户消息（隐式 attach） |
| `cancel` | 必填 | 取消生成（隐式 attach） |

### 下行（Server → Client）

| type | 说明 |
|------|------|
| `agent_event` | 包含具体的 data.type 子类型 |

## data.content 协议

### v1（旧）- 字符串

```json
{ "content": "hello world" }
```

### v2（新）- 结构化数组

```json
{
  "content": [
    { "type": "text", "data": "帮我提交代码" },
    { "type": "skill", "data": "octo-im-github" }
  ]
}
```

支持类型：
- `"text"` — 文本
- `"skill"` — 选中的 Skill 名称

**向后兼容**：后端 `_content_to_text()` 同时接受 string 和 array，自动归一化。

## metadata 字段

由前端自由填充，常用字段：

- `model` — LLM 模型
- `provider` — Provider 名称
- `agent_id` — Agent ID
- `session_id` — 当前 session
- `frame_id` — 后端回填的帧 ID（用于去重）
