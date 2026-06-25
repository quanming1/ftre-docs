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
    <aside className="sticky top-0 z-20 hidden h-[calc(100vh-64px)] w-[280px] shrink-0 flex-col overflow-hidden border-r border-black/[0.08] bg-white lg:flex">
      <nav className="flex-1 overflow-y-auto px-5 py-6">
        {Object.entries(groups).map(([category, items]) => (
          <section key={category} className="mb-6">
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-black/40">
              {category}
            </div>
            <div className="space-y-px">
              {items.map((doc) => {
                const active = currentPath === doc.path
                return (
                  <Link
                    key={doc.path}
                    to={`/docs/${doc.path}`}
                    className={`block rounded-md px-3 py-1.5 text-[14px] transition-colors ${
                      active
                        ? 'bg-black/[0.06] font-medium text-black'
                        : 'text-black/60 hover:bg-black/[0.03] hover:text-black'
                    }`}
                  >
                    {doc.title}
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
