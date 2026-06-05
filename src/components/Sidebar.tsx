import { useLocation, Link } from 'react-router-dom'
import { docs } from '../docs'
import { BookOpen, ChevronDown } from 'lucide-react'
import { useState } from 'react'

export default function Sidebar() {
  const location = useLocation()
  const currentPath = location.pathname.replace('/docs/', '')

  // 按 category 分组
  const groups = docs.reduce<Record<string, typeof docs>>((acc, doc) => {
    if (!acc[doc.category]) acc[doc.category] = []
    acc[doc.category].push(doc)
    return acc
  }, {})

  // 折叠状态
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggleGroup = (cat: string) => {
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }))
  }

  return (
    <aside className="w-[260px] shrink-0 bg-elevated border-r border-border flex flex-col h-full overflow-y-auto">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border/50 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
          <BookOpen size={17} className="text-accent" strokeWidth={2} />
        </div>
        <div>
          <div className="text-[15px] font-semibold text-white">ftre</div>
          <div className="text-[11px] text-white/40">技术文档</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-4">
        {Object.entries(groups).map(([category, items]) => (
          <div key={category}>
            <button
              onClick={() => toggleGroup(category)}
              className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/30 hover:text-white/50 transition-colors"
            >
              {category}
              <ChevronDown
                size={12}
                className={`transition-transform ${collapsed[category] ? '-rotate-90' : ''}`}
              />
            </button>
            {!collapsed[category] && (
              <div className="mt-1 space-y-0.5">
                {items.map((doc) => (
                  <Link
                    key={doc.path}
                    to={`/docs/${doc.path}`}
                    className={`block px-2 py-1.5 rounded-lg text-[13px] transition-colors ${
                      currentPath === doc.path
                        ? 'bg-accent/10 text-accent font-medium'
                        : 'text-white/55 hover:text-white/80 hover:bg-white/5'
                    }`}
                  >
                    {doc.title}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
    </aside>
  )
}
