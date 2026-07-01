# Octo 群聊 @ 检测门控 实现计划

> **For agentic workers:** 在当前 session 中内联执行。

**目标:** 在 Octo Channel Plugin 中实现群聊 @ 检测，bot 只在被 @ 时回复（MVP：不做免@ 偏好和成员 robot 分类）。

**架构:** 在 `OctoChannel._handle_message()` 中增加群聊消息的 mention 检测逻辑，复用 WuKongIM 协议中已有的 `mention` payload 字段，不修改桥接层。

**技术栈:** Python 3.12, asyncio, pytest

## 全局约束

- 只修改 `octo_channel.py` 和测试文件
- 日志和注释使用中文
- 不修改桥接层（`octo-bridge.js`）
- 配置项通过 `config.json` 的 plugins 数组传入
- MVP 不做免@ 偏好和成员 robot 分类

---

### Task 1: 添加 `requireMention` 配置项

**文件:**
- 修改: `C:\Users\蒋全明\.ftre\plugins\octo-plugin\octo_channel.py`

**接口:**
- 消费: `OctoChannel.__init__` 的 `config` 参数
- 产出: `self.require_mention: bool` 实例属性

- [ ] **Step 1: 在 `OctoChannel.__init__` 中读取配置**

```python
# 在 self._bot_uid = ... 之后添加:
self.require_mention = config.get("require_mention", True)
# require_mention 为 True 时，群聊中只有被 @ 才回复（默认行为）
# 设为 False 则群聊中所有消息都回复（类似免@）
```

- [ ] **Step 2: 验证语法**

```bash
python -c "import ast; ast.parse(open(r'C:\Users\蒋全明\.ftre\plugins\octo-plugin\octo_channel.py').read()); print('OK')"
```

---

### Task 2: 实现 @ 检测逻辑

**文件:**
- 修改: `C:\Users\蒋全明\.ftre\plugins\octo-plugin\octo_channel.py`

**接口:**
- 消费: `msg.payload.mention` 字段（WuKongIM 协议原生提供）
- 产出: `_is_mentioned()` 方法，返回 bool

- [ ] **Step 1: 添加 `_is_mentioned` 辅助函数**

在 `_handle_message` 方法之前添加：

```python
def _is_mentioned(self, payload: dict, from_uid: str, content: str) -> bool:
    """检测 bot 是否在消息中被 @。
    
    检测顺序（按优先级）：
      1. mention.uids 包含 bot_uid → 被直接 @
      2. mention.ais=1 → @AI / @所有AI
      3. 文本兜底：消息内容中正则匹配 @bot名称
    
    返回 True 表示 bot 被提及，应回复。
    """
    mention = payload.get("mention") or {}
    
    # 1. 直接 @bot
    uids = mention.get("uids") or []
    if self._bot_uid and self._bot_uid in uids:
        logger.debug(f"[octo] 被直接 @: bot_uid={self._bot_uid}")
        return True
    
    # 2. @AI / @所有AI
    ais = mention.get("ais")
    if ais is True or ais == 1:
        logger.debug(f"[octo] 被 @AI 提及")
        return True
    
    # 3. 文本兜底：检查内容中是否包含 @bot名称
    #    注意：mention payload 通常由 Octo 服务端填充，这里作为兜底
    if content and self._bot_name:
        import re
        escaped = re.escape(self._bot_name)
        pattern = re.compile(rf"(?:^|\s)@{escaped}(?:\s|$)")
        if pattern.search(content):
            logger.debug(f"[octo] 文本兜底检测到 @{self._bot_name}")
            return True
    
    return False
```

- [ ] **Step 2: 验证语法**

```bash
python -c "import ast; ast.parse(open(r'C:\Users\蒋全明\.ftre\plugins\octo-plugin\octo_channel.py').read()); print('OK')"
```

---

### Task 3: 在 `_handle_message` 中插入门控

**文件:**
- 修改: `C:\Users\蒋全明\.ftre\plugins\octo-plugin\octo_channel.py`

**接口:**
- 消费: `_is_mentioned()`, `self.require_mention`
- 产出: 群聊中非 @ 消息被跳过，记录日志

- [ ] **Step 1: 在过滤自己消息之后、非文本过滤之前插入门控**

在 `_handle_message` 中，找到 `# 过滤 bot 自己的消息` 那段代码之后，`# 非文本消息暂不处理` 之前，插入：

```python
        # 群聊 @ 检测门控：require_mention 为 True 时，只有被 @ 才回复
        if channel_type == CHANNEL_TYPE_GROUP and self.require_mention:
            if not self._is_mentioned(payload, from_uid, content):
                logger.info(
                    f"[octo] 群聊消息未 @ bot，跳过: "
                    f"发送者={from_uid} 频道={channel_id}"
                )
                return
```

- [ ] **Step 2: 验证语法**

```bash
python -c "import ast; ast.parse(open(r'C:\Users\蒋全明\.ftre\plugins\octo-plugin\octo_channel.py').read()); print('OK')"
```

---

### Task 4: 支持 bot_name 配置（文本兜底用）

**文件:**
- 修改: `C:\Users\蒋全明\.ftre\plugins\octo-plugin\octo_channel.py`

**接口:**
- 消费: `config.get("bot_name")`
- 产出: `self._bot_name` 实例属性

- [ ] **Step 1: 在 `OctoChannel.__init__` 中读取 bot_name**

```python
# 在 self._bot_uid = ... 之后添加:
self._bot_name = config.get("bot_name") or config.get("bot_id") or ""
```

- [ ] **Step 2: 验证语法**

同上。

---

### Task 5: 添加测试

**文件:**
- 修改: `E:\ftre\tests\test_octo_channel.py`

- [ ] **Step 1: 添加群聊 @ 检测相关测试**

在测试文件末尾添加：

```python
class TestOctoMentionGate:
    """群聊 @ 检测门控测试"""

    @pytest.fixture
    def channel(self, mock_bus, mock_session_manager):
        config = {
            "api_url": "https://im.deepminer.com.cn/api",
            "bot_token": "bf_test_token",
            "bot_id": "bot_self_001",
            "bot_name": "ftre开发",
            "require_mention": True,
        }
        ch = OctoChannel(config, mock_bus, session_manager=mock_session_manager)
        ch._bridge_proc = None  # 不需要真实桥接
        return ch

    @pytest.mark.asyncio
    async def test_group_mentioned_by_uid_dispatches(self, channel):
        """群聊中直接 @bot（uids 包含 bot_uid）→ 应投递消息"""
        msg = {
            "message_id": "m1", "message_seq": 1,
            "from_uid": "user_001", "channel_id": "group_001",
            "channel_type": 2,  # 群聊
            "timestamp": 1234567890,
            "payload": {
                "type": 1,
                "content": "你好 @ftre开发",
                "mention": {"uids": ["bot_self_001"]},
            },
        }
        with patch.object(channel, 'receive', new_callable=AsyncMock) as mock_receive:
            await channel._handle_message(msg)
            mock_receive.assert_called_once()

    @pytest.mark.asyncio
    async def test_group_mentioned_by_ais_dispatches(self, channel):
        """群聊中 @AI → 应投递消息"""
        msg = {
            "message_id": "m2", "message_seq": 2,
            "from_uid": "user_001", "channel_id": "group_001",
            "channel_type": 2,
            "timestamp": 1234567890,
            "payload": {
                "type": 1,
                "content": "这个问题谁会 @AI",
                "mention": {"ais": 1},
            },
        }
        with patch.object(channel, 'receive', new_callable=AsyncMock) as mock_receive:
            await channel._handle_message(msg)
            mock_receive.assert_called_once()

    @pytest.mark.asyncio
    async def test_group_not_mentioned_skipped(self, channel):
        """群聊中未被 @ → 不应投递消息"""
        msg = {
            "message_id": "m3", "message_seq": 3,
            "from_uid": "user_001", "channel_id": "group_001",
            "channel_type": 2,
            "timestamp": 1234567890,
            "payload": {
                "type": 1,
                "content": "今天天气不错",
            },
        }
        with patch.object(channel, 'receive', new_callable=AsyncMock) as mock_receive:
            await channel._handle_message(msg)
            mock_receive.assert_not_called()

    @pytest.mark.asyncio
    async def test_dm_always_dispatches(self, channel):
        """私聊消息始终投递，不受 require_mention 影响"""
        msg = {
            "message_id": "m4", "message_seq": 4,
            "from_uid": "user_001", "channel_id": "",
            "channel_type": 1,  # 私聊
            "timestamp": 1234567890,
            "payload": {
                "type": 1,
                "content": "你好",
            },
        }
        with patch.object(channel, 'receive', new_callable=AsyncMock) as mock_receive:
            await channel._handle_message(msg)
            mock_receive.assert_called_once()

    @pytest.mark.asyncio
    async def test_group_require_mention_false_always_dispatches(self, channel):
        """require_mention=False 时群聊消息始终投递"""
        channel.require_mention = False
        msg = {
            "message_id": "m5", "message_seq": 5,
            "from_uid": "user_001", "channel_id": "group_001",
            "channel_type": 2,
            "timestamp": 1234567890,
            "payload": {
                "type": 1,
                "content": "不用@也能回复",
            },
        }
        with patch.object(channel, 'receive', new_callable=AsyncMock) as mock_receive:
            await channel._handle_message(msg)
            mock_receive.assert_called_once()

    @pytest.mark.asyncio
    async def test_self_message_always_skipped(self, channel):
        """自己的消息始终跳过（即使有 @）"""
        msg = {
            "message_id": "m6", "message_seq": 6,
            "from_uid": "bot_self_001",  # 自己的 uid
            "channel_id": "group_001",
            "channel_type": 2,
            "timestamp": 1234567890,
            "payload": {
                "type": 1,
                "content": "我自己发的",
                "mention": {"uids": ["bot_self_001"]},
            },
        }
        with patch.object(channel, 'receive', new_callable=AsyncMock) as mock_receive:
            await channel._handle_message(msg)
            mock_receive.assert_not_called()

    @pytest.mark.asyncio
    async def test_text_fallback_mention_detection(self, channel):
        """文本兜底：内容包含 @bot名称 但无 mention payload → 应投递"""
        msg = {
            "message_id": "m7", "message_seq": 7,
            "from_uid": "user_001", "channel_id": "group_001",
            "channel_type": 2,
            "timestamp": 1234567890,
            "payload": {
                "type": 1,
                "content": "@ftre开发 帮我看下这个问题",
                # 无 mention payload（旧客户端）
            },
        }
        with patch.object(channel, 'receive', new_callable=AsyncMock) as mock_receive:
            await channel._handle_message(msg)
            mock_receive.assert_called_once()
```

- [ ] **Step 2: 运行测试**

```bash
cd /d E:\ftre && python -m pytest tests/test_octo_channel.py::TestOctoMentionGate -v
```

---

### Task 6: 提交

- [ ] **Step 1: 提交 octo-plugin 仓库**

```bash
cd /d C:\Users\蒋全明\.ftre\plugins\octo-plugin && git add octo_channel.py && git commit -m "feat: 群聊 @ 检测门控，bot 只在被 @ 时回复"
```

- [ ] **Step 2: 提交 ftre 测试**

```bash
cd /d E:\ftre && git add tests/test_octo_channel.py && git commit -m "test: 添加 Octo 群聊 @ 检测门控测试"
```