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
  { path: 'frame-format', title: '帧格式规范', category: '协议' },
  { path: 'attachments', title: '附件传输', category: '协议' },

  // 后端
  { path: 'backend-entry', title: '启动流程', category: '后端' },
  { path: 'channel-system', title: 'Channel 系统', category: '后端' },
  { path: 'agent-loop', title: 'Agent 循环', category: '后端' },
  { path: 'tool-system', title: 'Tool 系统', category: '后端' },
  { path: 'plugin-system', title: 'Plugin 系统', category: '后端' },
  { path: 'session-manager', title: 'Session 管理', category: '后端' },

  // Skill
  { path: 'skill-overview', title: 'Skill 概述', category: 'Skill' },
  { path: 'skill-create', title: '创建 Skill', category: 'Skill' },
  { path: 'skill-usage', title: 'Skill 使用与加载', category: 'Skill' },
]

// 导出 loader map 给 DocPage 使用
export const docLoaders = Object.fromEntries(
  docs.map((doc) => [doc.path, getDocLoader(doc.path)])
)
