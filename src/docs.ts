export interface DocEntry {
  path: string
  title: string
  category: string
}

// 使用 import.meta.glob 让 Vite 在构建时就能静态分析所有 .md 文件
const mdModules = import.meta.glob<string>('./content/*.md', { query: '?raw', import: 'default', eager: true })

function getDocLoader(path: string): (() => Promise<{ default: string }>) {
  const key = `./content/${path}.md`
  const loader = mdModules[key]
  return () => loader ? Promise.resolve({ default: loader }) : Promise.resolve({ default: `# ${path}\n\n内容待补充。` })
}

export const docs: DocEntry[] = [
  // 概览
  { path: 'overview', title: '项目概览', category: '概览' },
  { path: 'architecture', title: '架构设计', category: '概览' },
  { path: 'quickstart', title: '快速开始', category: '概览' },

  // 协议
  { path: 'ws-protocol', title: 'WebSocket 协议', category: '协议' },
  { path: 'bus-message', title: 'Bus 消息协议', category: '协议' },
]

// 导出 loader map 给 DocPage 使用
export const docLoaders = Object.fromEntries(
  docs.map((doc) => [doc.path, getDocLoader(doc.path)])
)
