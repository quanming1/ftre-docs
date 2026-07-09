# ChatInput 悬浮模式 Implementation Plan

> **历史计划**：本改造已落地。当前 `ftre-desktop/packages/renderer/src/features/chat/ChatView.tsx` 中 `ChatMessageList` 使用 `pb-[180px]` 底部 padding，`ChatInput` 通过 `absolute bottom-0 left-0 right-0` 悬浮在消息列表上方，只读 Channel 提示同样采用绝对定位。本文档保留为设计演化参考，具体实现请以当前源码为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** ChatInput 从固定底部改为悬浮在 ChatMessageList 上，消息可以滚到输入框下方。

**Architecture:** ChatView 容器保持 `relative`，ChatInput 改为 `absolute bottom-0`，ChatMessageList 加 `pb-[140px]` 防止最后一条消息被遮挡。

**Tech Stack:** React + Tailwind CSS

## Global Constraints

- 不改变 ChatInput 内部任何逻辑
- 输入框高度动态变化（min 64px ~ max 180px + 附件栏 + 工具栏），padding 需覆盖最大高度
- 不改变现有的拖拽、粘贴、Slash 菜单等交互

---

## 文件改动

仅 1 个文件：

| 文件 | 操作 |
|------|------|
| `packages/renderer/src/features/chat/ChatView.tsx` | 修改输入框布局 |

---

### Task 1: ChatInput 悬浮模式

**Files:**
- Modify: `packages/renderer/src/features/chat/ChatView.tsx:70-127`

**Interfaces:**
- Consumes: `ChatMessageList`, `ChatInput` 组件
- Produces: 悬浮布局

- [ ] **Step 1: ChatMessageList 加底部 padding**

将 `ChatMessageList` 的 `className` 从 `flex-1` 改为 `flex-1 min-h-0 pb-[140px]`：

```tsx
<ChatMessageList messages={messages} isBusy={isBusy} className="flex-1 min-h-0 pb-[140px]" />
```

`min-h-0` 防止 flex 子元素溢出，`pb-[140px]` 为浮动输入框留空间（覆盖最大高度 180px + 附件栏 + 工具栏 + padding）。

- [ ] **Step 2: ChatInput 改为绝对定位悬浮**

```tsx
// 改前
<ChatInput />

// 改后
<div className="absolute bottom-0 left-0 right-0">
  <ChatInput />
</div>
```

- [ ] **Step 3: ChatInput 添加底部渐变遮罩（可选，视觉更好）**

在 ChatInput 上方加一个渐变遮罩，让消息滚入输入框下方时淡出：

```tsx
<div className="absolute bottom-0 left-0 right-0">
  <div className="pointer-events-none h-8 bg-gradient-to-t from-white to-transparent" />
  <ChatInput />
</div>
```

- [ ] **Step 4: 处理只读 Channel 的占位**

只读 Channel 的提示也需要悬浮：

```tsx
// 改前
<div className="px-6 pb-4 pt-3">...</div>

// 改后
<div className="absolute bottom-0 left-0 right-0">
  <div className="px-6 pb-4 pt-3">...</div>
</div>
```

- [ ] **Step 5: 验证**

1. 发送多条消息，确认最后一条不被输入框遮挡
2. 输入多行文本，输入框高度变化时布局不跳
3. 拖拽图片到输入框，拖拽提示不被遮挡
4. 打开 Slash 菜单，面板不被裁剪
5. 切换 session，WelcomeView 不受影响
6. 只读 Channel 提示正常显示

- [ ] **Step 6: Commit**

```bash
cd E:\binn\ftre-desktop
git add packages/renderer/src/features/chat/ChatView.tsx
git commit -m "feat: ChatInput 悬浮模式 — 消息可滚到输入框下方"
```

## 校对记录

- **2026-08-08**：本文是历史计划记录。当前 `ftre-desktop/packages/renderer/src/features/chat/ChatView.tsx` 中 `ChatMessageList` 使用 `pb-[180px]` 底部 padding（与本文档 Task 1 Step 1 的 `pb-[140px]` 略有差异——当前实际值更大，覆盖 180px 附件栏 + 工具栏），`ChatInput` 通过 `absolute bottom-0 left-0 right-0` 悬浮在消息列表上方，只读 Channel 提示同样采用绝对定位；本文档保留为设计演化参考，具体实现请以当前源码为准。