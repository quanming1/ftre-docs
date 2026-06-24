import { Link, useLocation } from 'react-router-dom'
import { docs } from '../docs'

export default function Sidebar() {
  const location = useLocation()
  const currentPath = location.pathname.replace('/docs/', '')

  const groups = docs.reduce<Record<string, typeof docs>>((acc, doc) => {
    if (!acc[doc.category]) acc[doc.category] = []
    acc[doc.category].push(doc)
    return acc
  }, {})

  return (
    <aside className="sticky top-16 z-20 flex max-h-[calc(100vh-64px)] min-w-[220px] max-w-[420px] shrink-0 resize-x flex-col overflow-auto border-b border-black/[0.06] bg-white px-3 py-4 lg:h-[calc(100vh-64px)] lg:w-[292px] lg:border-b-0 lg:border-r">
      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-3 pr-1">
        {Object.entries(groups).map(([category, items]) => (
          <section key={category}>
            <div className="flex w-full items-center rounded px-2 py-1 text-left text-black/40">
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{category}</span>
            </div>

            <div className="mt-1 space-y-px">
              {items.map((doc) => {
                const active = currentPath === doc.path
                return (
                  <Link
                    key={doc.path}
                    to={`/docs/${doc.path}`}
                    className={`flex h-7 items-center rounded-full pr-3 text-[13px] transition-colors ${
                      active
                        ? 'bg-black/[0.06] font-medium text-black hover:bg-black/[0.06]'
                        : 'text-black/60 hover:bg-black/[0.03] hover:text-black'
                    }`}
                  >
                    <span className="w-6 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                  </Link>
                )
              })}
            </div>
          </section>
        ))}
      </nav>
    </aside>
  )
}
