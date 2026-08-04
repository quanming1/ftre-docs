# FTRE / DeepSeek 工具调用过程中提前停止问题交接

> 更新时间：2026-08-03  
> 目标读者：接手排查 FTRE Agent 工具调用稳定性的下一个 Agent  
> 当前结论：问题尚未解决；已有证据表明是 LLM/provider 返回了普通文本并主动 `stop`，但仍需找出为什么 DeepSeek 会在明确还有工作时不生成 `tool_call`。

## 1. 问题摘要

FTRE Agent 在执行连续工具任务时，会间歇性出现以下行为：

1. LLM 输出一句明显是“调用工具前的过渡语”；
2. 该次响应却没有生成任何 `tool_call`；
3. provider 返回 `finish_reason="stop"`；
4. Core 按标准 ReAct 语义把普通文本视为最终回答，结束本次 reply；
5. `state.json` 中该 assistant 消息被写成 `finished_reason="completed"`。

典型停止文本：

```text
TeamSayTool：记录消息投递到收件箱：
```

注意：这里模型并不是要调用名为 `TeamSayTool` 的 FTRE 工具。它当时正在修改
`E:\agentscope-team-demo\agentscope_team_demo.py`，这句话只是说明接下来准备为
`TeamSayTool` 类增加事件记录；按上下文，下一步应该生成 FTRE 的 `edit` 工具调用，
但实际响应中没有 `tool_call`。

## 2. 真实案例与时间线

主要会话快照：

```text
C:\Users\蒋全明\.ftre\sessions\ws_sess_eb9750f7c630\state.json
```

### 消息 23：第一次提前停止

```text
message index: 23
message id: 1866a54e2b894d36
model: deepseek-v4-flash
created_at: 2026-08-03T18:11:24.485347
finished_at: 2026-08-03T18:12:17.302381
finished_reason: completed
error: null
```

该 assistant 消息在停止前已经正常完成：

- 2 个 thinking block
- 5 个 text block
- 4 个 tool_call
- 4 个 tool_result
- 工具序列：`read → edit → edit → edit`

最后一个 text block 是：

```text
TeamSayTool：记录消息投递到收件箱：
```

之后没有第五个 `edit` 调用，reply 直接结束。

### 消息 25：用户催促后再次提前停止

用户随后发送 `？`。DeepSeek 新建了一次 reply，但只输出：

```text
用户打断了一下，我继续完成剩余打点：TeamSayTool 和 CheckInboxTool 以及 Worker/Leader 事件记录。
```

对应状态：

```text
message index: 25
message id: 16b7ba7b67b44e76
model: deepseek-v4-flash
finished_reason: completed
tool_call count: 0
```

它再次声明“继续”，但仍未生成工具调用。

### 消息 27：换成 GLM 后恢复执行

用户再次发送 `?` 后，新 reply 使用了 `tencent/glm-5.2`：

```text
message index: 27
message id: 38b6860220c74d09
model: tencent/glm-5.2
finished_reason: completed
tool_call count: 24
tool_result count: 24
```

GLM 随后连续完成了 edit/read/bash/write/Playwright 等调用并交付 HTML。

这个对照非常重要：同一个 session 没有损坏，工具系统也没有整体失效；DeepSeek
连续两次只说“继续”却不行动，而切换 GLM 后可以继续完成任务。问题至少具有明显的
模型或 provider 相关性。

## 3. 已确认的协议层证据

此前已检查该异常 LLM 调用的 trace，关联 run id：

```text
6d91a14b-219c-4aa7-9a0e-345d2ab3625b
```

响应特征：

```text
text = "TeamSayTool：记录消息投递到收件箱："
reasoning = ""
finish_reason = "stop"
has_tool_calls = false
```

因此不是 Core 收到了工具调用却丢失，也不是权限系统拒绝了工具。该次 provider
响应本身就没有 `tool_calls`。

`finished_reason="completed"` 只表示“本次 ReAct reply 按协议正常结束”，不代表
用户的业务任务已经语义完成。

## 4. Core 为什么会停止

FTRE Core 的停止判断位于：

```text
E:\ftre-agent-core\src\ftre_agent_core\agent\runner\react_runner.py
```

关键规则：

```python
if prev is not None and prev.tool_calls:
    return Acting(tool_calls=prev.tool_calls)

if prev is not None and prev.text.strip():
    return Exit(finished_reason=ReplyFinishedReason.COMPLETED)
```

也就是：

- 有 `tool_calls`：进入 Acting；
- 无 `tool_calls` 但有普通文本：视为最终回答；
- 空响应：进入已有的空响应重试/最终化流程。

本次异常响应并不为空，因此不会进入“空响应重试”。

## 5. AgentScope 对照结论

已检查本地 AgentScope：

```text
E:\agentscope\src\agentscope\agent\_agent.py
```

AgentScope 的基本停止语义与 FTRE Core 相同：

- thinking-only 响应继续 ReAct；
- 包含 `ToolCallBlock` 时执行工具；
- 非 interrupted、没有工具调用、且不是 thinking-only 时，生成最终
  `AssistantMsg(finished_reason=COMPLETED)`；
- `_next_action()` 看到 `final_msg` 后退出。

所以“普通文本且无工具调用就停止”不是 FTRE 独有实现，也不能简单通过“对齐
AgentScope”解决。如果同一份响应交给 AgentScope，默认也会停止。

不要直接把 Core 改成“只要文本看起来没做完就自动继续”，否则会破坏正常纯文本
回答的停止语义，并可能造成无限循环或重复执行有副作用的工具。

## 6. 请求参数对照与已做实验

### 6.1 Nanobot 样本请求

样本文件：

```text
E:\nanobot\opencode-req.json
```

关键参数：

```json
{
  "model": "deepseek-v4-flash",
  "max_tokens": 32000,
  "reasoning_effort": "max",
  "tool_choice": "auto",
  "stream": true,
  "stream_options": {
    "include_usage": true
  }
}
```

该样本没有 `thinking` 字段。消息统计中：

```text
content: null       = 0
content: ""         = 61
missing content     = 0
```

### 6.2 FTRE 当前请求构造

文件：

```text
E:\ftre-agent-core\src\ftre_agent_core\llm\completion.py
```

Chat Completions 当前行为：

- 固定发送 `tool_choice="auto"`；
- 固定流式并请求 usage；
- 配置了非空 `reasoning_effort` 时发送该字段；
- 模型名包含 `deepseek` 时，同时通过 `extra_body` 发送
  `thinking={"type":"enabled"}`；
- `max_tokens` 来自 FTRE 模型配置，本案例观察到为 `384000`。

Responses API 对应发送 `reasoning={"effort": ...}`。

### 6.3 已完成的 A/B 实验

曾临时在 Core 请求边界硬编码移除：

- `reasoning_effort`
- DeepSeek `thinking`
- Responses API 的 `reasoning`

用户实测后，提前停止问题仍然出现。因此这两个推理控制字段不是充分原因。

该临时 A/B 改动已经回滚，当前代码已恢复发送逻辑。

注意：这个实验没有同时把 FTRE 的 `max_tokens=384000` 对齐到 Nanobot 的
`32000`，也没有保证 FTRE 与 Nanobot 使用相同网关、相同 prompt、相同消息历史和
相同工具 schema。因此不能据此排除其他请求差异。

### 6.4 `content: null` 实验

Core 过去会把无正文的 assistant tool-call 消息规范化为：

```json
"content": null
```

现已改成：

```json
"content": ""
```

对应提交：

```text
d2c3cf0 fix(llm): normalize empty assistant content to empty string, not null
```

这个修改与 Nanobot 请求格式一致，但没有解决当前“过渡文本后不调用工具”的问题。

## 7. 当前尚不能下结论的部分

以下因素仍未完成严格的同请求 A/B：

1. **DeepSeek 模型本身的工具调用稳定性**：是否会以一定概率输出行动前言后直接 stop。
2. **实际 provider/gateway**：原异常消息快照只保存了模型名，没有保存 provider、
   base URL 或完整请求参数。当前 default Agent 配置已经是 `provider="ds"` 的本地代理，
   不应反推原异常调用一定经过同一个 provider。
3. **超长历史上下文**：该会话之前已经包含大量工具调用和较长 assistant 消息。
4. **最大输出长度**：FTRE 的 `384000` 与 Nanobot 的 `32000` 尚未单独对齐验证。
5. **system prompt / 工具 prompt 差异**：Nanobot 与 FTRE 的行为约束、工具描述不同。
6. **OpenAI 消息转换结果**：虽然已经有转换脚本，但尚未将“异常那一次的完整最终
   payload”保存后做确定性重放。
7. **网关流式拼装**：需要确认是否存在网关返回了 tool-call delta，但 SDK/解析器没有
   识别的极小概率情况。现有 trace 倾向于没有，但应通过原始 chunk 日志再验证一次。

## 8. 观测能力缺口

`LLMLogger.log_input()` 当前只记录：

- model
- messages
- tools
- 原始流式 chunks

它没有记录最终传给 SDK 的完整 `params`，因此无法从现有日志直接确认：

- `max_tokens`
- `reasoning_effort`
- `thinking`
- `tool_choice`
- `temperature`
- 实际 API 类型

下一步应优先增加**脱敏后的请求参数快照**，禁止记录 API key、Authorization 和其他
凭据。最好让 trace 中的单次 LLM run 同时保存：

```text
provider + model + api_type + sanitized params + raw finish_reason + tool-call count
```

## 9. 建议下一位 Agent 的排查顺序

### P0：构造可重复的原始请求重放

1. 从异常 LLM 日志中提取该次调用的完整 `messages` 和 `tools`。
2. 补齐当时的脱敏请求参数。
3. 写一个独立 Python 重放脚本，不经过 FTRE ReAct runner，只调用同一 provider。
4. 对完全相同的 payload 连续请求至少 20 次，记录：
   - `finish_reason`
   - 文本
   - reasoning 长度
   - tool-call 数量及名称
5. 统计“只输出过渡语、没有工具调用”的概率。

只有完成这一步，才能区分“模型随机性”与“FTRE 状态机/消息转换问题”。

### P1：同 payload 只替换模型或 provider

建议至少对照：

- `deepseek-v4-flash`（原模型）
- `tencent/glm-5.2`（本会话中实际恢复成功的模型）
- DeepSeek 经 OpenCode 与经 `ds` 本地代理（若两者都可用）

除 provider/model 外，messages、tools 和其他参数必须保持一致。

### P2：逐字段 A/B，不要一次改多个变量

按顺序分别测试：

1. `max_tokens: 384000` vs `32000`
2. `reasoning_effort: max` vs omit
3. `thinking` enabled vs omit
4. `tool_choice: auto` vs `required`

`tool_choice="required"` 只能用于诊断，不能直接作为全局修复：最终回答阶段也会被迫
调用工具，破坏正常停止语义。

### P3：验证原始流式 chunk

检查失败请求最后几个 chunk：

- 是否存在 `delta.tool_calls`；
- 是否只有 `delta.content`；
- 最终 `finish_reason` 是否确实为 `stop`；
- 是否存在供应商自定义工具字段而 Core 未解析。

### P4：再决定缓解策略

如果重放证明是模型的随机行为，优先级建议：

1. prompt 明确规定：“准备执行工具时，不要只输出行动前言；必须在同一次响应中生成
   tool call”；
2. 对特定模型/provider 做有限次数重试，而不是修改通用 ReAct 停止语义；
3. 对有显式未完成计划的任务，使用已有 `ON_STOP` hook 阻止停止并注入 continuation
   prompt；
4. 如需通用“未完成检测”，放在 FTRE 插件/应用层，避免 Core 依赖 FTRE 业务语义。

Core 已经提供 `ON_STOP` hook，Plan 插件也有“计划未完成则阻止停止”的实现，可以作为
应用层缓解方案参考：

```text
E:\ftre\src\ftre\plugin\builtin\plan_plugin.py
E:\ftre-agent-core\src\ftre_agent_core\agent\runner\_execute_acting.py
```

## 10. 不要混淆的其他问题

本问题与以下功能链路没有直接关系：

- Tool permission ASK/ALLOW/DENY；
- `UserConfirmResultEvent` 的 session 恢复；
- `REQUIRE_USER_CONFIRM` 回放；
- 客户端待确认卡片和 loading 状态。

本案例中根本没有生成目标 `edit` tool call，因此权限系统没有机会介入。

## 11. 当前仓库状态提示

写文档时观察到：

### `E:\ftre-agent-core`

最近相关提交：

```text
d2c3cf0 fix(llm): normalize empty assistant content to empty string, not null
a74f9ac refactor(permission): ownership of permission engine moves into ReActAgent
c109b2a fix(llm): explicitly set tool_choice=auto on both API paths
```

工作区还有两个未跟踪的消息转换测试 JSON：

```text
Njiknfgjinr.json
Njiknfgjinr.openai.json
```

不要删除，除非用户明确确认。

### `E:\ftre`

当前仍有与 PermissionRule/AgentManager 相关的未提交修改：

```text
M src/ftre/agent/agent_manager.py
M tests/test_agent_permission_rules.py
```

它们与本问题不是同一条改动线，排查时必须保留，不要顺手覆盖或回滚。

## 12. 验收标准

最终方案至少应满足：

1. 用固定 payload 重放可以稳定复现或给出统计结果；
2. 能明确问题发生在 provider、模型、消息转换或 runner 的哪一层；
3. 连续工具任务不再频繁停在“接下来我会……”这种过渡文本；
4. 正常纯文本最终回答仍能立即结束；
5. 不会重复执行已经成功的有副作用工具；
6. Core 保持独立，不引入 FTRE 专属业务判断；
7. DeepSeek 与至少一个对照模型都完成回归测试。

## 13. 一句话交接

不要继续猜停止状态机。先把失败那一次的**完整脱敏请求 + 原始流式响应**固化成可重复
重放样本；现有证据已经表明 Core 收到的是 `text + finish_reason=stop + no tool_calls`，
且移除 `reasoning_effort/thinking`、把 `content:null` 改成空字符串都没有解决问题。
