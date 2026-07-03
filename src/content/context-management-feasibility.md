# 上下文压缩简化方案：可行性分析

> 历史方案记录：本文保留的是更早期的可行性分析，**不代表当前实现**。
> 当前实际行为请以 `context-management.md` 为准：代码仍保留两个配置水位字段
> `precompact_threshold`（默认 0.5）与 `compact_threshold`（默认 0.6），但现有调用路径统一按
> `precompact_threshold` 触发压缩；当前代码没有写入 `enabled=false` 的路径，因此
> `enable_pending_compact()` 只承担兼容旧数据/历史数据的职责。

## 0. 目标

**把上下文压缩从"三级摘要器 + 双阈值 + 升级机制"简化为"一种 LLM 直调 + 一个水位 + silent/非 silent"**。

具体目标（历史方案，不是当前代码状态）：
- ✅ 只保留 LLM 直调作为唯一摘要方式（砍 subagent、砍 raw）
- ✅ 逻辑上只保留一个实际触发水位（但当前代码层面仍保留两个配置字段：`precompact_threshold` / `compact_threshold`）
- ✅ 自动压缩默认 `silent=true`（由 `agents.context.silent` 控制，前端不渲染），手动 `/compact` `silent=false`（前端渲染气泡）
- ✅ 暂不考虑 LLM 失败兜底，失败了下次再触发再试
- ✅ 游标机制、L1 prune、摘要并入（anchored）保留不变

---

## 1. 现状 vs 目标对比

| 维度 | 现状 | 目标 | 变化 |
|------|------|------|------|
| 摘要方式 | raw / llm / subagent 三级 | **只有 llm** | 删 2 种 |
| 触发水位 | 历史上曾是多阈值设计 | **目标是一个实际触发水位**（当前落地代码仍保留 `precompact_threshold=0.5` 与 `compact_threshold=0.6` 两个配置字段，但调用路径统一显式传 `precompact_threshold`） | 逻辑收敛 |
| 关键路径兜底 | raw 毫秒级兜底 | **无兜底** | 删 |
| raw→llm 升级 | 有 `should_upgrade_raw` | **无升级** | 删 |
| /compact | 用 subagent | **用 llm** | 改参数 |
| mode 字段 | "raw"/"llm"/"subagent" | **删掉** | 删 |
| silent | 有 | **有，不变** | 不变 |
| 游标机制 | 按事件流里的 `context_compact` 游标事件重建视图 | **不变** | 不变 |
| L1 prune | 有 | **不变** | 不变 |
| 摘要并入 | anchored | **不变** | 不变 |
| 前端 mode | 不存在 | **不存在** | 不变 |
| 前端 silent | 有 | **有，不变** | 不变 |

---

## 2. 可行性判断：逐模块分析

### 2.1 compact_handler.py — ✅ 可行，改动最大

**需删代码约 260 行，净减最多。**

| 删什么 | 位置 | 行数 | 风险 |
|--------|------|------|------|
| `_run_compact_subagent` 方法 | L689–756 | 68 | 低，无人引用 |
| `COMPACT_PROMPT_TEMPLATE` | L102–225 | 124 | 低，subagent 独用 |
| `raw_archive_chunk` 函数 | L982–1057 | 76 | ⚠️ **被 `_run_compact_llm` 复用** |
| `_slim_events` 方法 | L580–586 | 7 | 低，仅 raw 用 |
| `_do_compact` 路由分支 | L488–530 | ~42 | 改为只走 llm |
| `compact()` `fast` 参数 | L352–361 | ~10 | 低 |
| `compact()` `use_subagent` 参数 | L352–361 | ~10 | 低 |
| `SUBAGENT_CHANNEL_ID` import | L39 | 1 | 低 |
| subagent 轮询辅助（`_is_done`/`_get_final_content`等） | L758–837 | ~80 | 低，subagent 独用 |
| `should_upgrade_raw` 逻辑 | loop.py + handler | ~15 | 低 |

**⚠️ 关键风险：`raw_archive_chunk` 被 `_run_compact_llm` 复用**

`_run_compact_llm` 在 L621 调用 `raw_archive_chunk` 把事件流转成文本，再内联进 LLM prompt。
删掉 `raw_archive_chunk` 后，`_run_compact_llm` 需要新的方式生成 LLM 输入文本。

**解法**：把 `raw_archive_chunk` 重命名/重构为 `_format_events_for_llm`（或类似名称），去掉其中的
"截断 tool_result 500 字符"等 raw 专用逻辑，改为通用的"事件流 → markdown 文本"格式化。
这个函数本质上就是序列化事件流为 LLM 可读文本，llm 和 raw 都需要，只是参数不同。
保留函数体，调整截断参数即可。预估改动 ~30 行。

### 2.2 loop.py — ✅ 可行，改动中等

| 改什么 | 位置 | 说明 |
|--------|------|------|
| `_cmd_compact` | L109–174 | `use_subagent=True` → 删此参数，改为默认 llm |
| `_step_compact` | L236–261 | 删关键路径兜底逻辑（水位 ≥ threshold 时直接走 llm，不区分 fast/非 fast） |
| `_schedule_idle_compact` | L464–495 | 删 `should_preemptive_compact` 和 `should_upgrade_raw` 分支，改为简单的 `水位 ≥ threshold` |
| threshold 引用 | L236+ | `threshold` 从 0.8 改为 0.6（或从 config 读 `context.threshold`） |

### 2.3 config.py — ✅ 可行，改动小

| 改什么 | 位置 | 说明 |
|--------|------|------|
| 删 `preemptive_threshold` | L48 | 删字段 + camelCase/snake_case 解析 |
| `threshold` 默认值 | L47 | 0.8 → 0.6 |
| `consolidation_ratio` 默认值 | L49 | 0.7 → 0.5 |

### 2.4 manager.py — ✅ 无需改动

L1 prune 和 `to_openai_messages` 的 `context_compact` 处理逻辑不受影响。
唯一可能改的：`context_compact` 事件的 payload 删掉 `mode` 字段，但这只是写入时少写一个 key，
不影响重建逻辑。

### 2.5 前端 chat.ts — ✅ 无需改动

前端不感知 `mode` 字段，silent 逻辑已经是最简形态（`if (d.silent === true) return;`）。
简化后前端代码不需要任何改动。

---

## 3. 简化后的流程

```
一轮对话结束 → done / usage_update
                    └─ 检查水位 ≥ precompact_threshold(0.5)
                        ├─ 是 → LLM 直调摘要 → 写 context_compact(enabled=true, silent=config.context.silent，默认 true)
                        └─ 否 → 不压

用户发下一轮 → _step_compact 水位检查
    ├─ 水位 < precompact_threshold → 正常回复
    └─ 水位 ≥ precompact_threshold
         └─ _run_async 先尝试 enable_pending_compact()
              ├─ 命中历史 pending → 启用为 enabled=true 后正常回复
              └─ 无 pending（当前常态） → LLM 直调摘要(enabled=true, silent=config.context.silent，默认 true) → 正常回复

用户手动 /compact → 先尝试 enable_pending_compact()，无 pending 则 LLM 直调摘要(enabled=true, silent=false)
```

---

## 4. 参考对比：OpenCode 和 Nanobot 的简单之处

| 简单决策 | OpenCode | Nanobot | ftre 简化后 |
|----------|----------|---------|-------------|
| 单一 LLM 调用 | ✅ 只有一种 | ✅ 只有一种 | ✅ 只有一种 |
| 单一阈值触发 | ✅ overflow→触发 | ✅ 超 budget→触发 | ✅ 水位≥threshold→触发 |
| 不做 silent 区分 | ✅ 无概念 | ✅ 无概念 | ✅ 有 silent（但我们需要） |
| 游标用简单下标 | ✅ 数组切分 | ✅ int 索引 | ❌ timestamp 游标（事件流存储模型导致） |
| 失败不重试 | ✅ return false | ✅ break + raw | ✅ 失败就失败，下次再触发 |
| 不多级摘要 | ✅ | ✅ | ✅ |

**ftre 简化后唯一比 OpenCode/Nanobot 复杂的地方**：
1. **timestamp 游标**（因为不能删消息，只能插事件做分界）
2. **silent/非 silent**（因为我们有手动 `/compact` 要显气泡的需求）

这两点是架构差异导致的，不是过度设计，无法进一步简化。

---

## 5. 风险与对策

### 5.1 LLM 失败 → 水位不降

**场景**：LLM API 挂了/超时，摘要没产出，水位降不下来。

**影响**：下一轮用户发消息时，`to_openai_messages` 构建的 prompt 会更大，可能超过 context_window。

**对策**（暂不实现，但记录备用）：
- 方案 A：关键路径加 raw 兜底（回到双模式）
- 方案 B：LLM 失败时直接截断最旧的 tool_result（轻量兜底，不走完整 raw_archive）
- 方案 C：让 LLM API 更可靠（超时重试 1 次）

**当前决策（历史）**：暂不实现，失败了下次再触发再试。如果后续发现 LLM 失败率高，加方案 B。当前源码已额外加入后台 idle/usage 路径的不可重试 LLM 错误冷却：`auth_error` / `bad_request` / `content_filter` 会让该 session 后台压缩进入 300 秒冷却期；用户输入路径和手动 `/compact` 不受该冷却限制。

### 5.2 水位突然暴涨（用户粘贴超大文件）

**场景**：用户发了一条含数万字的消息，水位从 0.3 直接跳到 0.9。

**影响**：后台空闲压缩还没来得及跑，下一轮就超了。

**对策**：
- threshold=0.6 已经给了较大缓冲。水位从 0.3 跳到 0.9 的情况，即使 0.6 的预压缩也来不及。
- 这种极端情况下，`to_openai_messages` 会超过 context_window，LLM 会自己截断或报错。
- 真正的解法是 L1 prune——已经实现了，会在重建时截断冗长 tool_result。

### 5.3 subagent 精修质量没了

**场景**：用户手动 `/compact` 时，期望高质量摘要（subagent 多轮 ReAct），现在只有 LLM 直调。

**对策**：
- LLM 直调的摘要质量已经够用（`COMPACT_LLM_SYSTEM_PROMPT` 要求输出结构化 Markdown）
- 如果后续需要更高质量，可以加一个"精修"按钮（二次调用 LLM 用更详细 prompt），但当前不需要

---

## 6. 改动清单

### 后端（E:\ftre\src\ftre）

| 文件 | 改动 | 行数变化 |
|------|------|----------|
| `agent/compact_handler.py` | 删 subagent + raw + 路由分支 + 升级逻辑；重构 `raw_archive_chunk` 为 `_format_events_for_llm` | 净减 ~200 |
| `agent/loop.py` | 删 `_step_compact` 兜底逻辑；简化 `_schedule_idle_compact`；改 `/compact` 参数 | 净减 ~50 |
| `config.py` | 删 `preemptive_threshold`；改 `threshold` 默认值 0.8→0.6；改 `consolidation_ratio` 0.7→0.5 | 净减 ~5 |
| `session/manager.py` | 无改动 | 0 |
| 测试文件 | 删 subagent/raw 相关测试；更新 threshold 默认值 | 净减 ~30 |

### 前端（E:\binn\ftre-desktop）

| 文件 | 改动 | 行数变化 |
|------|------|----------|
| `chat.ts` | 无改动 | 0 |
| `chat.reducer.test.ts` | 无改动（silent 测试仍然有效） | 0 |

### 文档（E:\ftre-docs）

| 文件 | 改动 |
|------|------|
| `context-management.md` | 已更新为简化版 |

**总预估改动**：后端净减 ~285 行，前端 0 行。

---

## 7. 结论

**结论（历史）：该文档对应的简化方向曾被论证为可行。**

但从当前源码看，最终落地并不是本文中描述的那套“删掉一批字段、完全只保留一个配置阈值”的版本，而是：
- 保留了 `precompact_threshold` 与 `compact_threshold` 两个配置字段；
- 实际触发路径统一使用 `precompact_threshold`（默认 0.5）；
- `compact_threshold` 当前主要体现在压缩事件的 `enable_ratio` 元数据中；
- `enabled=false` / pending 启用逻辑仍保留在代码里用于兼容，但当前没有新写入路径。

因此，本文适合作为**设计演化背景**阅读，不应再作为实现说明引用；实现说明请看 `context-management.md`。

## 校对记录

- **2025-06-26**：作为历史方案记录保留，本文档描述的简化方向（删除 raw / subagent / 双阈值 / 升级机制等）与代码历史演进路径吻合。当前实现的真实情况已在 `context-management.md` 中详细说明，本文档不再作实现说明使用；
- 文中列出的「需删代码约 260 行」「风险点：`raw_archive_chunk` 被 `_run_compact_llm` 复用」等条目，是历史分析时点的状态，已不反映当前实现；当前实现虽已简化为单一 LLM 直调摘要，但配置层仍保留 `precompact_threshold` 与 `compact_threshold` 两个字段，且 `compact_manager.py`（原 `compact_handler.py`，已重命名）的 `compact()` 方法 docstring 中仍保留了"60% 无 pending 时"的旧说法（对应源码 line 230），实际调用路径应以 `context-management.md` 中按源码核对后的描述为准；
- 本次校对已补充上述说明，避免把当前源码中的历史注释误读为真实运行逻辑。
