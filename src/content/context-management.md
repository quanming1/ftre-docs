# 上下文管理机制设计

> ftre 已有一套上下文压缩（`ftre/agent/compact_handler.py` 的 `CompactHandler`）：长对话逼近
> 模型 `context_window` 时（`should_compact` 判 `total/cw > 0.8`），在用户消息的关键路径上派一个
> subagent 把历史读成"交接文档"式摘要，写入 `context_compact` 事件，重建 LLM 历史时丢弃该点
> 之前**所有**消息、只留摘要。
>
> 它的摘要质量高，但有四个硬伤：**(1) 全量丢弃**——连最近几轮原文都没了；**(2) 同步阻塞**——
> subagent 慢（实测 391s，超时上限 600s），用户发消息后要干等；**(3) 失败即放弃**——subagent
> 没产出合格摘要就什么都不做，水位继续涨；**(4) 每次重头摘**——无游标，旧摘要被丢弃重做。
>
> 本文方案：保留 ftre 的 subagent 摘要质量，借 **Nanobot** 的两个机制修掉这四点——
> **游标增量 + 保留尾部原文 + 失败 raw 兜底**（解决 1/3/4），**离线空闲压缩**（解决 2，做到无感）。
> 不引入分层（无 OpenCode 式 L1 工具修剪 / L3 溢出兜底），范围可控，向后兼容。

---

## 1. 目标：全自动 + 用户无感

"自动判断、自动压缩"现状已经有了（0.8 水位自动触发）。真正让用户**有感**的是两点：

| 有感来源 | 现状 | 消除办法 |
|----------|------|----------|
| **延迟** | 发消息 → 关键路径同步压缩（subagent 数分钟）→ Agent 才回 | **后台空闲压缩**：上一轮 `done` 后台悄悄压，下次发消息零等待 |
| **可见** | 前端渲染 `context_compact_start/done` 气泡 | **静默**：后台压缩不进消息流，历史回放气泡默认折叠 |

无法 100% 消除的极端情况：某轮上下文**突然暴涨**、后台空闲压缩还没跑。此时关键路径仍需压
一次，但走 **raw 兜底（毫秒级）**而非慢 subagent，延迟可忽略（见第 5 节）。

---

## 2. 核心概念：游标（cursor）

借 Nanobot 的 `last_consolidated` 思想。在 ftre 里，**最新一条 `context_compact` 事件就是游标**：

```
事件流（按 timestamp 升序）：

[e0 e1 ... ek]  [context_compact(summary)]  [e_{k+1} ... e_n]
└── 已压缩 ──┘   └──── 游标/分界 ────┘   └──── 尾部原文(tail) ──┘
  被摘要替代            summary 注入            原样参与 LLM 重建
```

- 游标**之前**：被摘要替代（`to_openai_messages` 丢弃 + 注入 `[历史上下文摘要]`）。
- 游标**之后**（tail）：原样保留，继续以原始事件参与重建。
- 游标**只进不退**：下次压缩从上一个游标之后开始，不重摘旧内容。

> 现状等价于"游标永远 = 末尾、tail 永远为空"。本方案让游标停在一个**保留尾部**的位置。

### 2.1 关键底层改动：游标必须能落在历史中间

这是实现游标的**前置条件**，现有代码不支持，必须先改：

- 真实 `SessionManager.save_message` 永远用 `time.time()` 当时间戳、追加到末尾。无法把
  `context_compact` "插"到历史中间某个边界位置。
- 而 `to_openai_messages` 是按事件在列表中的**顺序**决定"谁在游标前、谁在后"。

因此需要二选一（推荐前者，改动小）：

- **方案 A（推荐）**：`save_message` 增加可选 `timestamp` 参数。写 `context_compact` 时传入
  "边界事件的 timestamp − ε"，使其排在边界前、tail 后。
- **方案 B**：`context_compact` payload 增加 `cursor_event_id`（指向 tail 起点事件），
  `to_openai_messages` 据此切分，不依赖 timestamp 顺序。

无论哪个方案，`to_openai_messages` 的 `context_compact` 分支都改为：**丢弃游标之前的消息 +
注入摘要 + 保留游标之后的 tail**（现状是丢弃之前所有、不保留之后）。多条 `context_compact`
以**最后一条**（最新游标）为准。

---

## 3. 压缩算法

### 3.1 两套标准的分工（先讲清，避免混淆）

| 标准 | 决定什么 | 取值 | 是否改动 |
|------|----------|------|----------|
| **触发水位** `total/cw > 0.8` | **何时压**（`should_compact`） | 0.8 | **不变** |
| **预算 target** | **压到哪、留多少 tail** | 见 3.2 | 新增 |

即：水位决定"该压了"，预算决定"这次压完后剩多少、tail 留多少"。两者独立，不冲突。

### 3.2 预算与目标

```
budget = context_window - max_output - SAFETY_BUFFER      # 可用输入预算
target = budget * consolidation_ratio                     # 压完后 prompt 估算要降到这条线以下
```

- `max_output` 用 config 已有的 `llm.max_output`（缺省时退回 `context_window * 0.8` 兜底）；
  `SAFETY_BUFFER` 默认 1024。
- `consolidation_ratio` 默认 **0.7**（**非 Nanobot 的 0.5**）。理由：Nanobot 用便宜的单次 LLM
  摘要、可多轮，敢压到一半；ftre 用 subagent（贵、慢、单轮），应**压到刚好安全 + 尽量多留
  tail**，而不是激进压掉一大半历史。0.7 在"压一次能撑一阵"与"tail 留得够多"之间取平衡。

### 3.3 边界选取（照 Nanobot `pick_consolidation_boundary`）

从游标往后扫，目标移除约 `estimated - target` 的 token。**在每个 user-turn 起点**记候选边界，
累计移除够了就停：

- 边界**必须落在 `USER_INPUT` 事件**（user-turn 起点），保证 `tool_call`/`tool_result` 成对。
- 累计移除 token ≥ 待移除量时返回该边界；扫到尾都不够就用最后一个合法边界（能压多少压多少）。
- 找不到任何 user 边界（就一轮且超长）→ 本次不压（交给后续，或极端时由 raw 兜底强切）。

边界**之后**就是 tail，大小由"target 还剩多少预算"动态决定——**预算紧就少留、宽就多留**，
比写死的固定轮数更自适应。

### 3.4 单轮压缩（ftre 与 Nanobot 的关键差异，⚠️ 不做多轮 subagent）

Nanobot 的 `maybe_consolidate_by_tokens` 是**多轮循环**（最多 5 轮），因为它每轮的 `archive()`
只是**一次普通 LLM 调用（秒级）**。

**ftre 不能照搬多轮**：ftre 的 `summarize` = 派发一个完整 subagent session（实测 391s、超时
600s）。多轮串行 = 最坏 50 分钟，连后台都压不完，与"无感"背道而驰。

所以 ftre 的策略是**一次 compact 只摘一段、只派一个 subagent**：

```
1. estimated = 估算当前 prompt token
2. boundary  = pick_boundary(待移除 = estimated - target)   # 一次选好边界
3. chunk     = 游标 .. boundary 之间的事件                    # 一段
4. summary   = summarize(chunk)                              # 一个 subagent（或 raw，见第 5 节）
5. 写 context_compact(summary)，游标 = boundary              # 游标前进
```

一次摘到 `target` 是否够？由 3.3 的边界选取保证——它一次就选出"能移除足够 token"的边界。
若单次确实压不到位（历史极长），**不靠多轮 subagent 硬扛**，而是：本次先压一段降低水位，
下一轮 `done` 的后台空闲压缩再续压一段（游标已前进，不重做）。把"多轮"摊到**多次空闲窗口**
里，而不是在一次关键操作里串行等 5 个 subagent。

### 3.5 摘要并入（anchored）+ 失败兜底

- **摘要并入**：把**上一条 `context_compact` 的 summary** 一并喂给 subagent，让它在旧摘要基础上
  更新，而非孤立只摘新 chunk。避免多次压缩后摘要彼此脱节、早期信息漂移。对应 Nanobot 的
  `_last_summary` 注入。`_run_compact_subagent` 导出 chunk 时附带 `previous_summary`，prompt
  模板加一段"在以下旧摘要基础上更新"。
- **失败兜底**：subagent 超时 / 未产出合格摘要时，**不再像现状那样直接放弃**，而是退回本地
  raw 截断（用户消息全留、`tool_result` 截断，无 LLM、毫秒级），`mode="raw"`，**游标照常前进**
  （Nanobot 经验：失败不前进会重复摘同一段、刷重复 `[RAW]`）。糙摘要会在下次后台空闲压缩时
  被 subagent 基于 tail 原文重摘升级，不会永久降质。

---

## 4. 摘要器按时机选：subagent 还是 raw

`summarize(chunk, fast)` 两种实现，按压缩发生的**时机**选：

| 时机 | 摘要器 | 理由 |
|------|--------|------|
| **后台空闲压缩**（第 5 节） | `fast=False` → subagent | 不占用户时间，要质量 |
| **关键路径被迫压**（空闲没赶上、单轮暴涨） | `fast=True` → raw | 用户在等，速度第一 |
| **subagent 失败兜底**（3.5） | 自动退 raw | 保证有产出、游标能进 |

---

## 5. 无感关键：后台空闲压缩（照 Nanobot AutoCompact）

### 5.1 把压缩挪出关键路径

**现状**：压缩在 `_run_async` 里、Agent 执行**之前**同步跑 → 用户发消息后要等。

**改为**：压缩主要发生在**会话空闲时**——一轮 Agent 执行结束（`_run_async` finally 里发 `done` /
`idle` 之后），后台检查水位，需要就异步压一段（`fast=False`，subagent）。下次用户发消息时
上下文已压好，零等待。

```
用户发消息 → Agent 正常回复 → done(idle)
                                  └─(后台)→ 检查水位 →[超阈值]→ subagent 压一段
                                                                （慢没关系，用户在看回复/已离开）
```

下次 `user_input` 进来时，`_step_compact` 仍做轻量水位检查作**保险**：
- 正常：后台已压好，水位低于阈值 → 放行，零延迟。
- 兜底：后台没赶上（连续快速追问、单轮暴涨）→ 关键路径压一次，走 `fast=True`（raw），毫秒级。

### 5.2 实现陷阱（必须处理）

`_run_async` 跑在 `run_in_executor` 线程里、用 `asyncio.run()` 开了**独立事件循环**，该循环在
函数返回后即关闭。因此**不能**在 finally 里简单 `asyncio.ensure_future(后台压缩)`——任务会
随临时循环销毁而被取消。正确做法：

- 把后台压缩任务**提交回主事件循环**（`self._event_loop`），而非当前临时循环。例如在 finally
  里 `asyncio.run_coroutine_threadsafe(self._schedule_idle_compact(session_id), self._event_loop)`，
  由主循环负责把它再 fire-and-forget 到 executor 线程执行 `compact(fast=False)`。
- 这样既不阻塞当前轮收尾，后台压缩又有稳定的宿主循环。

### 5.3 死锁约束 + 并发锁

- 后台压缩派 subagent，subagent 的 inbound 靠 AgentLoop 唯一消费循环处理。故后台压缩必须在
  **消费循环空闲**时、在 executor 线程里跑（与现状 `_run_async` 压缩同款规避手法，见
  `CompactHandler` 文件头注释）。
- **每 session 一把压缩锁**（对应 Nanobot `get_lock(session.key)`）：ftre 现无此设施，需新增。
  防止 idle 压缩与关键路径兜底压缩、或同 session 连续 idle 压缩撞车导致游标错乱。

---

## 6. UI 静默

- 后台空闲压缩：带 `silent: true`，前端不渲染气泡（或干脆不发实时事件，只写 DB 事件供回放）。
- 关键路径 raw 兜底压缩：同样 `silent: true`。
- 历史回放里的 `context_compact` 气泡：保留但**默认折叠/极简**，用户想看才展开。

---

## 7. 协议改动（向后兼容，新增字段旧前端忽略）

`context_compact` 事件（持久化 + 历史回放）新增：

| 字段 | 类型 | 说明 |
|------|------|------|
| `mode` | string | `"subagent"` / `"raw"`。缺省按 `"subagent"` |
| `tail_turns` | number | 本次保留的尾部 user-turn 数。缺省 0（旧全量替换语义） |
| `silent` | bool | true 时前端不渲染气泡（后台/兜底压缩用）。缺省 false |
| `cursor_event_id` | string | 仅方案 B 需要：tail 起点事件 id（见 2.1） |

`context_compact_done` 实时事件同样可带 `mode` / `tail_turns` / `silent`。

> **`to_openai_messages` 行为变更**（唯一语义变化）：遇到 `context_compact` 仍"丢弃之前 + 注入
> 摘要"，但**不再丢弃其后事件**，且**不再要求它是最后一个事件**。tail 原文照常重建。

---

## 8. 不变量

仅列本方案特有、易踩坑的约束（通用死锁约束见第 5.3 节、`CompactHandler` 文件头）：

- **tool 配对**：边界必须以 user-turn（`USER_INPUT`）为单位，保证 `tool_calls`（assistant）与
  `tool`（result）成对，否则 OpenAI 协议报错。
- **游标只进不退**：成功失败都前进，避免重复摘同一段。
- **DB 是真相源**：压缩只追加 `context_compact` 事件改变"重建视图"，**不物理删历史**；前端历史
  回放（`GET /messages`，不传压缩参数）始终能看到完整原文。

---

## 9. 配置项

`~/.ftre/config.json` 的 `agents.defaults.context` 下，缺省回退代码默认：

```json
{
  "agents": {
    "defaults": {
      "context": {
        "consolidationRatio": 0.7,
        "safetyBuffer": 1024,
        "idleCompaction": true,
        "silent": true
      }
    }
  }
}
```

| 常量 | 默认 | 说明 / 对应 |
|------|------|-------------|
| `CONSOLIDATION_RATIO` | 0.7 | 压缩目标占 budget 比例（ftre 调高于 Nanobot 的 0.5，见 3.2） |
| `SAFETY_BUFFER` | 1024 | Nanobot `_SAFETY_BUFFER` |
| `IDLE_COMPACTION` | true | 开后台空闲压缩（Nanobot AutoCompact 思想） |
| `SILENT` | true | UI 静默 |

触发水位 `DEFAULT_COMPACT_THRESHOLD = 0.8`、token 估算（`token_counter.py`）—— **不变**。

> 注意：本方案**不设** `MAX_CONSOLIDATION_ROUNDS`——ftre 单次压缩只摘一段（3.4），多轮被摊到
> 多次空闲窗口，没有"一次压缩内循环 N 轮"的概念。

---

## 10. 实施步骤

1. **底层**（前置）：`save_message` 支持自定义 `timestamp`（方案 A）或 `context_compact` 加
   `cursor_event_id`（方案 B）。
2. **重建**：`to_openai_messages` 的 `context_compact` 分支保留游标后事件，多条以最后一条为准。
3. **算法**：`compact_handler.py` 加 `pick_compaction_boundary` + 单轮"选边界→摘一段→游标前进"
   + `summarize(chunk, fast)` + 每 session 压缩锁。
4. **摘要并入**：`_run_compact_subagent` 带上 `previous_summary`，prompt 模板加 anchored 段。
5. **无感**：`loop.py` 在 `_run_async` finally 把 idle 压缩任务提交回主循环（5.2 陷阱）；
   `_step_compact` 关键路径走 `fast=True`。
6. **配置 + UI**：`config.py` 读新配置；前端见 `silent` 不渲染、回放气泡折叠。

每步向后兼容，可单独验证、单独上线。**建议先 1–4（机制），再 5（无感），最后 6（配置/UI）。**

---

## 11. 与参考实现的对应

| 维度 | ftre 现状 | 本方案（ftre 摘要 + Nanobot 机制） |
|------|-----------|-----------------------------------|
| 摘要产出 | subagent 交接文档 | **不变**（保留质量优势） |
| 压缩范围 | 全量、全丢 | **游标增量 + 保留 tail** |
| 切分边界 | 末尾（全切） | **user-turn 边界，按待移除 token 选取** |
| 压缩目标 | 一次到位、无目标 | **单次压到 target = budget×0.7** |
| 多轮 | 无 | **不在一次压缩内多轮；摊到多次空闲窗口（≠ Nanobot 的循环）** |
| 旧摘要 | 丢弃重做 | **并入更新（anchored）** |
| 失败处理 | 放弃、不前进 | **raw 兜底，游标照进** |
| 压缩时机 | 关键路径同步（用户等待） | **后台空闲为主 + 关键路径 raw 兜底（无感）** |
| UI | 渲染气泡 | **静默** |
| 触发 / token 估算 | 0.8 水位 / anchor+CJK 粗估 | **不变** |

核心取舍：**Nanobot 的"游标 + 预算 + 保留尾部 + 兜底 + 离线压缩"机制成立，但它的"多轮 LLM
摘要循环"在 ftre 的 subagent 成本下不成立**——故 ftre 改为"单次摘一段 + 多次空闲窗口续压"。
摘要质量仍由 ftre 自己的 subagent 保证。不引入 OpenCode 式 L1/L3 分层（列为将来可选）。
