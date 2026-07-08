export interface DocEntry {
  path: string
  title: string
  category: string
}

// 使用 import.meta.glob 让 Vite 在构建时就能静态分析所有 .md 文件（含子目录）
const mdModules = import.meta.glob<string>('./content/**/*.md', { query: '?raw', import: 'default', eager: true })

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
  { path: 'agent-events', title: 'Agent 事件协议', category: '协议' },
  { path: 'context-management', title: '上下文管理机制', category: '协议' },

  // 指令
  { path: 'commands', title: '指令系统', category: '指令' },

  // 插件
  { path: 'plugin-system', title: '插件系统', category: '插件' },
  { path: 'plugin-builtins', title: '内置插件', category: '插件' },
  { path: 'octo-plugin', title: 'Octo Channel 插件', category: '插件' },

  // 配置
  { path: 'config-file', title: '配置', category: '配置' },
  { path: 'mcp', title: 'MCP 服务器', category: '配置' },
  { path: 'skill', title: 'Skill', category: '配置' },

  // 工具
  { path: 'tools', title: '内置工具', category: '工具' },

  // 客户端
  { path: 'client/session-loading', title: '切换 Session 数据加载', category: '客户端' },
]

// 导出 loader map 给 DocPage 使用
export const docLoaders = Object.fromEntries(
  docs.map((doc) => [doc.path, getDocLoader(doc.path)])
)
