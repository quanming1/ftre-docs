# 上下文管理机制设计

> 本文设计 ftre 的上下文（context）管理机制：在长对话不断逼近模型 `context_window`
> 上限时，如何持续、稳定、低损耗地把历史压进可用预算内，同时尽量不丢失"接着干活"所
> 需的关键信息。
>
> 设计参考了两套成熟实现的对比（OpenCode 三层递进 `Prune→Compact→Overflow`、Nanobot
> 单循环 + 离线 AutoCompact），并结合 ftre 自身的**事件流 + SQLite + subagent 摘要**
> 架构做了取舍。涉及三个仓库：`ftre`（网关 / Agent Loop / 压缩核心）、`ftre-agent-core`
> （ReAct 循环 / token 估算）、`ftre-desktop`（前端展示）。

---

## 1. 现状与问题

ftre 当前已有一套上下文压缩机制（`ftre/agent/compact_handler.py` 的 `CompactHandler`），
属于**单层、全量替换式**压缩：

1. `_step_compact` 阶段读 DB，按 `get_token_usage().total / llm.context_window` 算水位，
   超过 `DEFAULT_COMPACT_THRESHOLD = 0.8` 则标记 `need_compact`。
2. `_run_async` 在 Agent 正式执行前同步调用 `compact()`：把整条事件流导出成临时 JSON，
   派发一个 subagent session 去读、生成一份"交接文档"式 markdown 摘要。
3. 摘要写入 `context_compact` 事件。`SessionManager.to_openai_messages` 重建 LLM 历史
   时，遇到 `context_compact` 会**丢弃该点之前的所有消息**，用 `[历史上下文摘要]\n{summary}`
   作为唯一新起点。
4. token 用量用 anchor（最近一次真实 `usage_update` / `done.usage`）+ 之后事件字符级粗估
   拼出（`token_counter.py`）。

对照两套参考实现，现状有这些缺口：

| 维度 | 现状 | 问题 |
|------|------|------|
| 分层 | 单层 Compact | 没有"轻量修剪"和"硬兜底"两道防线，要么不压、要么大动作压 |
| 工具输出 | 不单独处理 | 一条 `tool_result` 动辄几万字符（读大文件 / `bash` 长输出），单条就能顶爆窗口，却要等整体水位到 0.8 才压 |
| 压缩粒度 | 全量丢弃 + 摘要替换 | 摘要后**最近几轮原文也没了**，AI 丢失"刚刚在干什么"的精确上下文，容易重复劳动 |
| 触发 | 仅主动估算（0.8 水位） | 估算偏差或单轮暴涨时，可能直接撞上 provider 的 context overflow 硬错误，当前无兜底，整轮 `error` |
| 压缩成本 | subagent 摘要（曾观测 391s，超时上限 600s） | 慢、占额度、偶发"中间口播当摘要"。无快速降级路径 |
| 续行 | 无 | 压缩后不自动续跑，用户得手动再发一句 |

> 结论：现有 subagent 摘要质量高、值得保留，但需要在它**之前**加一道便宜的实时修剪，在它
> **之后**加一道不依赖 LLM 的硬兜底，并把"全量丢弃"改成"摘要 + 保留尾部原文"，形成三层防线。

---

## 2. 设计总览：三层防线

借鉴 OpenCode 的三层递进，落到 ftre 的事件流模型上：

```
                       每轮 user_input 进入 AgentLoop
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
   ┌────┴─────┐             ┌─────┴──────┐            ┌──────┴───────┐
   │  L1 修剪 │             │  L2 压缩   │            │  L3 兜底     │
   │  Prune   │             │  Compact   │            │  Overflow    │
   └────┬─────┘             └─────┬──────┘            └──────┬───────┘
        │                         │                          │
 重建消息时对历史          水位 ≥ threshold 时        provider 抛 context
 tool_result 做           派发 subagent 摘要 +       overflow 时，同步
 head/tail 截断           保留尾部最近 N 轮原文       raw 截断兜底，不依
 （无 LLM，零成本）        （高质量，有成本）          赖 LLM（保命）
```

三层职责互斥、由轻到重，命中靠前的就不必动靠后的：

- **L1 修剪（Prune）**：每次重建 LLM 消息时无条件执行，纯字符串截断，零 LLM 成本。
  目标是把"又长又是噪音"的历史工具输出压扁，通常这一层就能让水位长期待在阈值之下。
- **L2 压缩（Compact）**：水位越过阈值才触发，沿用现有 subagent 摘要，但改为
  **head（摘要）+ tail（最近 N 轮原文）** 的保留策略，并支持快速降级。
- **L3 兜底（Overflow）**：只有当请求真的被 provider 以 context-length 错误拒绝时才触发，
  同步、无 LLM、保证这一轮能继续，绝不让用户撞到裸 `error`。

---

## 3. L1 — 实时工具输出修剪（Prune）

### 3.1 动机

事件流里最占地方、信息密度又最低的，几乎总是 `tool_result`：读一个大文件、`bash` 一条
长输出、`grep` 一大片命中，单条就可能上万字符。但它们绝大多数在"被读过一次、AI 已据此
行动"之后就成了噪音——后续轮次只需要知道"读过、结果大致是 X"，不需要逐字重放。

OpenCode 用 `TOOL_OUTPUT_MAX_CHARS = 2000` + `PRUNE_PROTECT = 40000` 解决：只截断"较老
且较长"的工具输出，保护最近一段窗口内的原文。ftre 照搬这个思路，落在
`to_openai_messages` 重建环节。

### 3.2 策略

在把事件流折成 OpenAI messages 时，对 `tool_result` 按"距今远近"差异化处理：

- **保护窗口**：最近 `PRUNE_PROTECT_TOKENS`（默认 ≈ 12000 token）内的 `tool_result` 一律
  原样保留，绝不截断——AI 最近的动作必须看到完整结果。
- **修剪区**：保护窗口之外的 `tool_result`，单条超过 `TOOL_OUTPUT_MAX_CHARS`（默认 2000
  字符）就做 head/tail 截断，中间替换为占位：

  ```
  <前 1000 字符>
  …[修剪 N 字符]…
  <后 1000 字符>
  ```

- **失败结果不修剪**：`error != null` 的 `tool_result` 通常很短且含关键报错，保留原文。

L1 只改"喂给 LLM 的临时视图"，**不改 DB**。历史回放（前端拉 `/messages`）仍返回完整原文，
用户随时能看到完整工具输出。这一点和 L2/L3 的"持久化改写"不同。

### 3.3 落点

`SessionManager.to_openai_messages` 增加一个可选的修剪上下文参数：

```python
@staticmethod
def to_openai_messages(
    events: list[MessageModel],
    *,
    config: dict | None = None,
    prune: PruneOptions | None = None,   # 新增：None 表示不修剪（历史回放场景）
) -> list[dict]:
    ...
```

- `AgentLoop._build_messages` 构建"喂 LLM"的消息时传入 `prune`（启用 L1）。
- HTTP `GET /messages` 等历史回放场景不传 `prune`（保留完整原文给前端）。

`PruneOptions` 是个轻量 dataclass：`protect_tokens` / `max_chars` / `head_chars` /
`tail_chars`，全部从配置注入（见第 7 节）。

---

## 4. L2 — 主动压缩（Compact）

### 4.1 沿用现有 subagent 摘要

L2 保留现有 `CompactHandler` 的核心：导出事件流 → 派发 subagent → 生成交接文档式摘要 →
写 `context_compact` 事件。subagent 摘要质量高、能跨轮提炼决策与产物，是 ftre 的优势，
不推倒重来。

触发条件不变：`should_compact()` 判断 `total / context_window > threshold`（默认 0.8）。
但有两处关键改动。

### 4.2 改动一：head + tail，保留尾部原文

**现状的硬伤**：`context_compact` 事件会让 `to_openai_messages` 丢弃**之前所有**消息，
意味着压缩后连"最近一两轮的原始对话"都没了，只剩摘要。AI 失去刚刚动作的精确上下文
（具体改了哪行、报错原文是什么），容易推翻重来。

**改法**：压缩时选一个 **user-turn 边界**作为分割点（参考 Nanobot 的
`pick_consolidation_boundary`），把历史分成两段：

```
[……很早的历史……] [最近 N 轮完整对话]
        │                  │
     被摘要              原样保留
        ▼                  ▼
   context_compact      不动，继续以原始事件参与 LLM 重建
   事件(summary)
```

- **head（边界之前）**：交给 subagent 摘要，写进 `context_compact` 事件。
- **tail（边界之后，最近 N 轮）**：原样保留，继续以原始事件参与后续 LLM 重建。

对应 `to_openai_messages` 的 `context_compact` 分支改为：**只丢弃该事件之前的消息**，
其后的原始事件（即 tail）照常重建。因为 `context_compact` 事件是在 tail 起点之前写入的，
所以"丢弃之前 + 保留之后"天然就实现了 head/tail 切分——无需额外标记。

> 实现要点：压缩完成写 `context_compact` 时，它在事件流里的**插入位置**就是分割边界。
> 当前是追加到末尾（等于全丢）。改为：先用 `pick_compaction_boundary()` 找到"倒数第
> N 个 user-turn"的位置，把 `context_compact` 事件的 `timestamp` 设在该边界之前的事件
> 与边界之间，使重建时 tail 落在边界之后。由于 `messages` 表按 `timestamp ASC` 排序，
> 这样回放顺序天然正确。

边界选择规则（`pick_compaction_boundary`）：

- 至少保留最近 `COMPACT_TAIL_TURNS`（默认 2）个完整 user-turn 作为 tail。
- 边界必须落在 user-turn 起点，避免把"半轮"（有 tool_call 没 tool_result）切开，导致
  OpenAI 协议里 `tool_calls` 与 `tool` 消息不配对。
- 如果 tail 本身已经超过预算的一半，说明最近几轮就很重，退化为只保留最近 1 轮。

### 4.3 改动二：快速降级（subagent 可选）

subagent 摘要慢（分钟级）且偶发失败。L2 增加一条**降级链**：

1. **首选**：subagent 摘要（现状逻辑，质量最高）。
2. **降级**：subagent 超时 / 未产出合格摘要时，不再像现在那样直接放弃，而是退到
   **raw 截断摘要**——把 head 段的事件按"用户消息全留、tool_result 截 500 字"的规则，
   本地拼一份纯文本摘要（无 LLM，毫秒级），写进 `context_compact` 事件，`mode` 标记为
   `"raw"`。保证压缩一定有产出，不会"压了个寂寞"。

降级产出的摘要质量低于 subagent，但配合 L2 的 tail 原文保留，足以让对话继续。

### 4.4 改动三：压缩后自动续行（可选，默认关）

参考 OpenCode 的 synthetic "Continue"：压缩在 `_run_async` 里、Agent 正式执行前完成，
本就无缝衔接当前这轮 user_input，**ftre 天然不需要额外续行**（这是相对 Nanobot 离线
压缩的优势）。仅在 `/compact` 手动压缩且当时无待处理 user_input 的场景，可选地补一条
synthetic 提示让 AI 总结现状。默认关闭，避免打扰。

---

## 5. L3 — 溢出兜底（Overflow）

### 5.1 动机

L1 + L2 都是"事前估算"驱动的。但估算永远可能偏差（不同 provider 的 tokenizer 不同、
图片 token、system prompt 膨胀），单轮也可能暴涨。一旦真的把超长 prompt 发出去，provider
会以 context-length-exceeded 类错误拒绝，当前 ftre 直接走 `error` 事件、整轮失败。

L3 是最后一道保命防线：**捕获 overflow 错误 → 同步做一次不依赖 LLM 的硬截断 → 用截断后
的上下文重试本轮**。

### 5.2 机制

需要 `ftre-agent-core` 配合（见第 6 节）。`ReActRunner` 在 LLM 调用处捕获 context-overflow
类错误，向上抛一个明确的 `ContextOverflowError`（而不是笼统的 `error`）。`AgentLoop._run_async`
捕获它：

1. 调用 `CompactHandler.overflow_compact(session_id)`：同步、无 subagent，直接对当前消息
   做硬截断——
   - 丢弃最老的若干 user-turn（成对丢弃，保持 tool 配对）。
   - 对保留段的 `tool_result` 用更激进的 `OVERFLOW_TOOL_MAX_CHARS`（默认 500）截断。
   - 把被丢弃段落压成一条极简 raw 摘要事件（`mode="overflow"`）。
2. 用截断后的消息**重建并重试本轮**，最多重试 `OVERFLOW_MAX_RETRIES`（默认 2）次，每次
   更激进。
3. 仍然失败才走 `error`。

L3 牺牲质量换"这一轮能跑完"，是兜底而非常态——只要 L1/L2 工作正常，L3 几乎不会触发。

---

## 6. 三仓库职责划分

| 仓库 | 职责 | 改动 |
|------|------|------|
| `ftre-agent-core` | ReAct 循环、token 估算原语、overflow 错误识别 | 新增 `ContextOverflowError`；在 LLM 调用处识别 provider 的 context-length 错误并抛出；（可选）暴露一个统一的 token 估算工具函数供上层复用 |
| `ftre` | 上下文管理核心：L1 修剪、L2 压缩边界与降级、L3 兜底、协议事件 | `CompactHandler` 扩展（边界选择 / 降级 / overflow）；`SessionManager.to_openai_messages` 加 `prune` 与 head/tail 语义；`token_counter` 不变；`config` 加新配置项 |
| `ftre-desktop` | 展示压缩状态、tail 保留提示、修剪标记 | `context_compact` 气泡显示 `mode`（subagent/raw/overflow）与保留轮数；（可选）工具卡片显示"结果已折叠"标记 |

> `ftre-agent-core` 改动最小（只加一个错误类型 + 错误识别），核心逻辑都在 `ftre`，符合
> "core 只管单次 ReAct 循环，会话级上下文治理归网关层"的现有分工。

---

## 7. 配置项

全部挂在 `~/.ftre/config.json` 的 `agents.defaults.context` 下，给出默认值；缺省时回退到
代码内默认常量，保证旧配置零改动可用。

```json
{
  "agents": {
    "defaults": {
      "context": {
        "compactThreshold": 0.8,        // L2 触发水位
        "tailTurns": 2,                 // L2 保留的最近 user-turn 数
        "prune": {
          "enabled": true,              // L1 总开关
          "protectTokens": 12000,       // 保护窗口（此窗口内 tool_result 不截断）
          "toolOutputMaxChars": 2000,   // 修剪区单条 tool_result 阈值
          "headChars": 1000,            // 截断保留头部字符
          "tailChars": 1000             // 截断保留尾部字符
        },
        "overflow": {
          "enabled": true,              // L3 总开关
          "toolMaxChars": 500,          // overflow 时的激进截断
          "maxRetries": 2               // overflow 重试次数
        }
      }
    }
  }
}
```

对应代码常量（默认值，配置缺省时生效）：

| 常量 | 默认 | 层 | 位置 |
|------|------|----|------|
| `COMPACT_THRESHOLD` | 0.8 | L2 | `compact_handler.py` |
| `COMPACT_TAIL_TURNS` | 2 | L2 | `compact_handler.py` |
| `PRUNE_ENABLED` | true | L1 | `compact_handler.py` |
| `PRUNE_PROTECT_TOKENS` | 12000 | L1 | `compact_handler.py` |
| `TOOL_OUTPUT_MAX_CHARS` | 2000 | L1 | `compact_handler.py` |
| `PRUNE_HEAD_CHARS` / `PRUNE_TAIL_CHARS` | 1000 / 1000 | L1 | `compact_handler.py` |
| `OVERFLOW_TOOL_MAX_CHARS` | 500 | L3 | `compact_handler.py` |
| `OVERFLOW_MAX_RETRIES` | 2 | L3 | `compact_handler.py` |

---

## 8. 协议改动

向后兼容为原则：新增字段一律可选，旧前端忽略不影响渲染。

### 8.1 `context_compact` 事件（持久化 + 历史回放）

现有字段：`summary` / `events_before` / `tokens_before`。新增：

| 字段 | 类型 | 说明 |
|------|------|------|
| `mode` | string | 摘要来源：`"subagent"`（首选）/ `"raw"`（L2 降级）/ `"overflow"`（L3 兜底）。缺省按 `"subagent"` |
| `tail_turns` | number | 本次压缩保留的尾部 user-turn 数（head/tail 切分后）。缺省 0（旧的全量替换语义） |

**`to_openai_messages` 行为变更**：遇到 `context_compact` 仍"丢弃之前所有消息 + 注入摘要"，
但**不再丢弃其后的事件**（tail 原文照常重建）。由于切分边界由事件插入位置决定，重建逻辑
本身几乎不变，只是不再要求 `context_compact` 必须是最后一个事件。

### 8.2 `context_compact_start` / `_done` 实时事件

`_done` 增加 `mode` 与 `tail_turns`，供前端在压缩气泡上显示"已用 subagent 摘要，保留最近
2 轮原文"之类提示。`_start` 不变。

### 8.3 新增 `context_overflow`（实时，可选持久化）

L3 触发时发一条实时事件告知前端"刚刚触底兜底了"：

```json
{
  "type": "agent_event",
  "data": {
    "type": "context_overflow",
    "data": { "retries": 1, "dropped_turns": 3 }
  }
}
```

前端展示一条轻量 system 提示即可；不强制持久化。

### 8.4 L1 修剪不入协议

L1 只改"喂 LLM 的临时视图"，不改 DB、不发事件，前端无感知。可选地在 `tool_result` 渲染时，
前端自行判断 `result` 长度给个"展开/折叠"，与后端 L1 无耦合。

---

## 9. 关键不变量与死锁约束

沿用现有 `CompactHandler` 的死锁约束（见其文件头注释），新增防线不得违背：

1. **inbound 单队列、AgentLoop 唯一消费者**：L2 的 subagent 压缩只能在"消费循环空闲"时
   执行（即 `_run_async` 的 fire-and-forget 线程里），`should_compact()` 判断阶段绝不
   派发 / 等待 subagent。
2. **L1 修剪纯同步、无 IO**：只做字符串处理，可在任何位置安全调用（包括主循环）。
3. **L3 兜底纯同步、无 subagent**：在 `_run_async` 捕获 overflow 后直接本地截断重试，
   不派发新 session，绝不引入新的自依赖等待。
4. **tool 配对不变量**：任何切分 / 丢弃（L2 边界、L3 丢弃）都必须以 user-turn 为单位，
   保证 `tool_calls`（assistant）与 `tool`（result）消息成对，否则 OpenAI 协议报错。
5. **DB 是唯一真相源**：L1 不改 DB；L2/L3 通过追加 `context_compact` 事件改变"重建视图"，
   不物理删除历史消息（前端历史回放始终可见完整原文）。

---

## 10. 实施顺序（建议）

按风险与收益排序，可独立分批落地：

1. **L1 修剪**（收益最高、风险最低、不动协议）：`to_openai_messages` 加 `prune`，
   `_build_messages` 启用。多数长对话靠这一层就能把水位长期压住。
2. **L2 head/tail**（改善压缩后体验）：`pick_compaction_boundary` + `context_compact`
   事件插入位置调整 + 协议加 `mode` / `tail_turns`。
3. **L2 降级链**（提升压缩鲁棒性）：subagent 失败时退 raw 摘要。
4. **L3 兜底**（保命，需 core 配合）：`ftre-agent-core` 抛 `ContextOverflowError`，
   `AgentLoop` 捕获并 overflow 重试。
5. **前端展示**（体验收尾）：压缩气泡显示 `mode` / 保留轮数，overflow 轻提示。

每一步都向后兼容，可单独验证、单独上线。

---

## 11. 与参考实现的对应关系

| 能力 | OpenCode | Nanobot | ftre（本设计） |
|------|----------|---------|----------------|
| 工具输出修剪 | Prune 层（40K 保护 / 2K 截断） | 无 | **L1**（protect 12K / 2K 截断） |
| 主动压缩 | Compact（锚定摘要） | maybe_consolidate（SNIP 摘要） | **L2**（subagent 摘要） |
| 尾部原文保留 | tail_turns | consolidation_cursor | **L2** head/tail 边界 |
| 溢出兜底 | Overflow（抛错停止） | raw_archive 截断 | **L3**（截断 + 重试，更进一步） |
| 降级 | 报错停止 | raw_archive | **L2** 降级链 + **L3** 兜底 |
| token 估算 | length/4 | tiktoken | anchor + 字符粗估（现状保留） |
| 续行 | synthetic Continue | 不续行 | 天然无需（压缩在执行前） |

ftre 的设计在两者之上做了融合：保留自身高质量 subagent 摘要，补齐 OpenCode 的修剪层与
溢出防线，并把"全量丢弃"升级为"摘要 + 尾部原文"，同时全程不物理删历史、前端始终可见原文。
