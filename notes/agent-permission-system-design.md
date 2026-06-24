---
title: Agent 之：权限系统设计
source: https://mp.weixin.qq.com/s/XAtt8hxGWTSlYmPhA7ZMmg
author: 机器学习与大数据挖掘
date: 2026-05-23
tags: [agent, permission, security, tool-use]
---

# Agent 之：权限系统设计

> 主流的 Agent 可以帮我们执行各种命令，其中当然也包括非常危险的命令（删除、修改）。
> 如果对大模型生成的命令无条件放行让它执行，可能会产生严重后果。
> **权限控制对 Agent 系统来说非常重要。**

---

## 1. 权限的作用对象

聊权限之前，先要了解权限的**作用对象**。Agent 的一个核心功能是可以帮我们执行各种工具，那么权限的作用对象就是**工具**。

工具类型有很多种，有些可以不放权限、默认执行，有些则需要严格的权限判断。典型工具：

| 工具 | 类型 | 危险性 |
|------|------|--------|
| `command` | 系统层级命令行（ls, rm, pwd 等） | 高危 |
| `write_file` | 自定义写文件工具 | 中危 |
| `read_file` | 自定义读文件工具 | 安全 |
| `web_search` | 自定义网络搜索工具 | 安全 |

读工具、网络搜索没有危害，可以默认执行；写工具、系统层命令行工具带有危险色彩，需要权限管控。

---

## 2. 权限系统的模块

为了实现对权限的规范化、系统化管控，整个权限系统设计包括如下模块：

### 2.1 权限系统

权限系统的功能可以理解成**「一条管道」**，用来判断某条待执行命令/工具调用的接下来执行状态：

- 这次调用要不要**直接拒绝**？
- 能不能**自动放行**？
- 剩下的要不要**问用户**？

### 2.2 权限模式

权限模式是系统当前的总体风格，例如：

- **谨慎一点**：大多数操作都问用户
- **保守一点**：只允许读，不允许写
- **流畅一点**：简单安全的操作自动放行

### 2.3 行为的处置规则

规则就是「遇到某种工具调用时，该怎么处理」。例如下面的一个工具调用请求：

```json
{
  "tool": "bash",
  "content": "sudo *",
  "behavior": "deny"
}
```

表示一个 bash 工具，本次要执行 `sudo` 命令，行为应该是被**拒绝 deny** 的。

---

## 3. 权限系统具体设计

在 Agent 一次对话循环中，只要知道：
1. 本次循环碰到了什么工具
2. 这个工具应该具备哪些权限
3. 是否需要请求用户确认

弄明白了这些，权限系统的设计就自然出来了。**一个基本正确的权限系统只需要这四步：**

```
tool_call
   │
   ▼
1. deny rules    -> 命中了就拒绝
   │
   ▼
2. mode check    -> 根据当前模式决定
   │
   ▼
3. allow rules   -> 命中了就放行
   │
   ▼
4. ask user      -> 剩下的交给用户确认
```

四个步骤的含义：

1. **首先**是非常高危的执行命令，碰到了就直接拒绝，不允许有任何余地；
2. **其次**根据当前系统模式决定，例如模式偏紧，那么对于一些日常的写操作就需要用户来确认；
3. 有了模式以后，直接看工具命令匹配什么权限就怎么执行；
4. **最后**需要用户确认的，弹出来由用户确认。

### 常规系统权限模式（本项目所采用）

先把下面三种做稳：

| 模式 | 含义 | 适合什么场景 |
|------|------|--------------|
| `default` | 未命中规则时问用户 | 日常交互 |
| `plan` | 只允许读，不允许写 | 计划、审查、分析 |
| `auto` | 简单安全操作自动过，危险操作再问 | 高流畅度探索 |

---

## 4. 权限系统的数据结构

权限系统主要针对工具执行，可以设计一个权限系统的类来管理工具权限：

```python
class PermissionManager:
    """管理工具调用的权限决策。

    权限管道：拒绝规则 -> 模式检查 -> 允许规则 -> 询问用户
    """

    def __init__(self, mode: str = "default", rules: list = None):
        if mode not in MODES:
            raise ValueError(f"Unknown mode: {mode}. Choose from {MODES}")
        self.mode = mode
        self.rules = rules or list(DEFAULT_RULES)
        ...

    def check(self, tool_name: str, tool_input: dict) -> dict:
        """
        返回: {"behavior": "allow" | "deny" | "ask", "reason": str}
        """
        # Step 0: Bash security validation (before deny rules)
        # 步骤0：Bash 安全校验（优先于拒绝规则执行）

        # Step 1: Deny rules (bypass-immune, checked first always)
        # 步骤1：拒绝规则（不可绕过，始终优先校验）

        # Step 2: Mode-based decisions
        # 步骤2：基于运行模式做权限决策

        # Step 3: Allow rules
        # 步骤3：放行/允许规则

        # Step 4: Ask user (default behavior for unmatched tools)
        # 步骤4：向用户询问确认（未匹配规则的工具默认行为）

    def ask_user(self, tool_name: str, tool_input: dict) -> bool:
        """交互式批准提示。如果批准则返回 True。"""

    def _matches(self, rule: dict, tool_name: str, tool_input: dict) -> bool:
        """检查规则是否匹配工具调用。"""
```

整个权限内就包括这么几个小部分，**最关键的是 `check` 函数的实现**，用于判断在不同系统模式下、不同工具调用所能执行的权限。

### check 函数具体例子

```python
def check(tool_name: str, tool_input: dict) -> dict:
    # 1. deny rules
    for rule in deny_rules:
        if matches(rule, tool_name, tool_input):
            return {"behavior": "deny", "reason": "matched deny rule"}

    # 2. mode
    if mode == "plan" and tool_name in WRITE_TOOLS:
        return {"behavior": "deny", "reason": "plan mode blocks writes"}

    if mode == "auto" and tool_name in READ_ONLY_TOOLS:
        return {"behavior": "allow", "reason": "auto mode allows reads"}

    # 3. allow rules
    for rule in allow_rules:
        if matches(rule, tool_name, tool_input):
            return {"behavior": "allow", "reason": "matched allow rule"}

    # 4. fallback
    return {"behavior": "ask", "reason": "needs confirmation"}
```

例如直接拒绝的规则里，可以在 `matches` 函数里写：执行 bash 命令时如果碰到 `sudo` 和 `rm -rf` 这一类，就**直接拒绝**。

---

## 5. 具体的使用方法

有了权限控制类之后，看一次对话循环调用工具中的主函数：

```python
perms: PermissionManager = PermissionManager(mode=mode_input)

def agent_loop(messages: list, perms: PermissionManager):
    while True:
        # 调用大模型接口，生成助手回复
        response = client.messages.create(
            model=MODEL, system=SYSTEM, messages=messages,
            tools=TOOLS, max_tokens=8000,
        )

        # 将大模型助手回复追加到对话历史
        messages.append({"role": "assistant", "content": response.content})

        # 如果大模型不需要调用工具，直接结束本轮智能体循环
        if response.stop_reason != "tool_use":
            return

        results = []

        # 遍历模型返回的每一个内容块，只处理工具调用类型
        for block in response.content:
            if block.type != "tool_use":
                continue

            # ========== 权限校验核心逻辑 ==========
            # 权限管理器校验：工具名 + 入参，返回权限决策
            decision = perms.check(block.name, block.input or {})

            # 分支1：规则直接拒绝调用该工具
            if decision["behavior"] == "deny":
                # 拼接权限拒绝提示信息
                output = f"Permission denied: {decision['reason']}"

            # 分支2：需要向人工用户发起询问确认
            elif decision["behavior"] == "ask":
                # 询问用户是否允许执行该工具
                if perms.ask_user(block.name, block.input or {}):
                    # 用户同意：找到对应工具处理器并执行
                    handler = TOOL_HANDLERS.get(block.name)
                    output = handler(**(block.input or {})) if handler else f"Unknown: {block.name}"
                else:
                    # 用户拒绝：返回用户否决提示
                    output = f"Permission denied by user for {block.name}"

            # 分支3：权限放行，直接允许执行工具
            else:  # allow 允许
                handler = TOOL_HANDLERS.get(block.name)
                output = handler(**(block.input or {})) if handler else f"Unknown: {block.name}"

            # 封装工具调用结果为标准会话结构
            results.append({
                "type": "tool_result",
                "tool_use_id": block.id,          # 关联对应工具调用ID
                "content": str(output),           # 工具执行/拒绝结果内容
            })

        # 将本轮所有工具结果以用户消息形式追加进对话历史，供大模型下一轮继续思考
        messages.append({"role": "user", "content": results})
```

在一次循环的过程中，使用权限控制就是这样来决定整个过程的。更复杂的权限管理需要灵活地设计权限模块。

---

## 学习笔记 / 与 ftre 对照

这篇文章的权限模型与 ftre 后端现有的权限体系高度同构，可直接对照映射：

| 文章概念 | ftre 中的对应物 | 备注 |
|----------|-----------------|------|
| 权限的作用对象 = 工具 | Tool 体系（`ftre-agent-core` 的 Tool 基类） | 权限挂在每次 tool_call 上 |
| deny rules | 高危命令黑名单（`sudo`、`rm -rf`） | 应在 `check` 第 0/1 步、不可绕过 |
| mode check | `default` / `plan` / `auto` 三态 | 对应 channel / session 的运行模式 |
| allow rules | 只读工具白名单 | `read_file` / `web_search` 自动放行 |
| ask user | WebSocket 弹窗让用户在 desktop 确认 | desktop 侧应实现审批 UI |
| 四步管道 `deny→mode→allow→ask` | 建议在 `PermissionManager.check` 中严格按序实现 | 步骤顺序不可调换 |

### 可落地的改进点

1. **deny 规则必须 bypass-immune**：即使用户切到 `auto` 模式，`sudo *` / `rm -rf /` 这类也必须先拦下来。文章 Step 0 的 Bash 安全校验就是为此预留的钩子。
2. **mode 应可热切换**：用户在 desktop 上随时从 `default` 切到 `plan`（分析模式），切回去再走 `auto`。后端 EventBus 可以广播 mode change 事件。
3. **ask_user 要异步可超时**：长任务里用户长时间不响应要有默认策略（默认 deny + 把超时结果塞回对话历史），避免 agent_loop 卡死。
4. **规则匹配 `_matches` 应支持通配符**：文章里 `sudo *` 就用了通配符，说明 `_matches` 不能是字符串全等，要支持 glob / 正则。

更多历史参考：[Agent之：上下文压缩方法](https://mp.weixin.qq.com/s?__biz=MzI4ODc4MDk2OA==&mid=2247486629&idx=1&sn=53e03bffb4d04d20abe0ddb78de22b02&scene=21#wechat_redirect)
