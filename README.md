# ftre 技术文档站

基于 Vite + React + TypeScript 搭建的 ftre 项目文档站点。

## 快速开始

```bash
pnpm install
pnpm dev
```

## 目录结构

```
src/
├── content/       # ← 在这里写 .md 文档
│   ├── overview.md
│   ├── architecture.md
│   ├── ws-protocol.md
│   └── ...
├── components/
│   ├── Sidebar.tsx   # 左侧分组导航
│   └── DocPage.tsx   # MD 渲染页面
├── docs.ts           # 文档清单（注册新文档在这）
├── App.tsx           # 路由
└── main.tsx          # 入口
```

## 添加新文档

1. 在 `src/content/` 下新建 `.md` 文件
2. 在 `src/docs.ts` 中添加条目：

```ts
{ path: 'my-new-doc', title: '新文档标题', category: '分类名' }
```

3. 侧边栏会自动按 category 分组展示

## 构建

```bash
pnpm build
```

产物输出到 `dist/`。
