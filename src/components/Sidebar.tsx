import { Link, useLocation } from 'react-router-dom'
import {
  Boxes,
  Code2,
  Layers3,
  Library,
  Plug,
  type LucideIcon,
} from 'lucide-react'
import { docs } from '../docs'

const categoryIcons: Record<string, LucideIcon> = {
  '概览': Library,
  '协议': Code2,
  '后端': Layers3,
  Skill: Plug,
}

const fallbackIcons = [Library, Code2, Layers3, Plug, Boxes]

export default function Sidebar() {
  const location = useLocation()
  const currentPath = location.pathname.replace('/docs/', '')

  const groups = docs.reduce<Record<string, typeof docs>>((acc, doc) => {
    if (!acc[doc.category]) acc[doc.category] = []
    acc[doc.category].push(doc)
    return acc
  }, {})

  return (
    <aside className="sticky top-20 z-20 flex max-h-[calc(100vh-80px)] shrink-0 flex-col border-b border-border-subtle bg-[#fbfbfc] px-3 py-4 lg:h-[calc(100vh-80px)] lg:w-[292px] lg:border-b-0 lg:border-r">
      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-3 pr-1">
        {Object.entries(groups).map(([category, items], index) => {
          const Icon = categoryIcons[category] ?? fallbackIcons[index % fallbackIcons.length]

          return (
            <section key={category}>
              <div className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-t-muted">
                <Icon size={15} strokeWidth={1.8} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{category}</span>
              </div>

              <div className="mt-1 space-y-px">
                {items.map((doc) => {
                  const active = currentPath === doc.path
                  return (
                    <Link
                      key={doc.path}
                      to={`/docs/${doc.path}`}
                      className={`flex h-9 items-center rounded-full pr-3 text-[13.5px] transition-colors ${
                        active
                          ? 'bg-active-doc font-medium text-t-primary hover:bg-active-doc'
                          : 'text-t-secondary hover:bg-hover hover:text-t-primary'
                      }`}
                    >
                      <span className="w-[34px] shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                    </Link>
                  )
                })}
              </div>
            </section>
          )
        })}
      </nav>
    </aside>
  )
}
