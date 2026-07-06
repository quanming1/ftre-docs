import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { DocEntry } from '../docs'
import { docLoaders, docs } from '../docs'

interface TocItem {
  id: string
  text: string
  level: 2 | 3
}

export default function DocPage({ doc }: { doc: DocEntry }) {
  const [content, setContent] = useState<string | null>(null)
  const [toc, setToc] = useState<TocItem[]>([])
  const [activeId, setActiveId] = useState<string>("")

  useEffect(() => {
    let cancelled = false
    setContent(null)
    setToc([])
    setActiveId("")
    docLoaders[doc.path]().then((mod) => {
      if (!cancelled) setContent(mod.default)
    })
    return () => { cancelled = true }
  }, [doc])

  // 从 DOM 中提取标题，保证 ID 与渲染时生成的完全一致
  useEffect(() => {
    if (content === null) return
    const frame = requestAnimationFrame(() => {
      const headings = Array.from(
        document.querySelectorAll<HTMLElement>(".prose-docs h2[id], .prose-docs h3[id]"),
      )
      if (headings.length === 0) return
      const items: TocItem[] = headings.map((h) => ({
        id: h.id,
        text: h.textContent || "",
        level: h.tagName === "H3" ? 3 : 2,
      }))
      setToc(items)
      setActiveId(headings[0].id)
    })
    return () => cancelAnimationFrame(frame)
  }, [content, doc.path])

  // 滚动监听 — 高亮当前可视标题
  useEffect(() => {
    if (toc.length === 0) return

    const scrollContainer = document.getElementById("ftre-docs-main")
    if (!scrollContainer) return

    const handleScroll = () => {
      const containerTop = scrollContainer.getBoundingClientRect().top + 64
      let currentId = toc[0].id
      for (const item of toc) {
        const h = document.getElementById(item.id)
        if (!h) continue
        if (h.getBoundingClientRect().top <= containerTop + 40) {
          currentId = item.id
        }
      }
      setActiveId(currentId)
    }

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll()
    return () => scrollContainer.removeEventListener("scroll", handleScroll)
  }, [toc])

  const handleTocClick = useCallback((id: string) => {
    const h = document.getElementById(id)
    if (!h) return
    h.scrollIntoView({ behavior: "auto", block: "start" })
    setActiveId(id)
  }, [])

  if (content === null) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="text-[14px] text-black/40">Loading...</div>
      </div>
    )
  }

  const renderedContent = content.replace(/^#\s+.+(?:\r?\n)+/, '')

  const { prev, next } = (() => {
    const index = docs.findIndex((item) => item.path === doc.path)
    return {
      prev: index > 0 ? docs[index - 1] : null,
      next: index >= 0 && index < docs.length - 1 ? docs[index + 1] : null,
    }
  })()

  const headingCounts = new Map<string, number>()
  const nextHeadingId = (children: ReactNode) => {
    const baseId = slugify(nodeText(children))
    const count = headingCounts.get(baseId) ?? 0
    headingCounts.set(baseId, count + 1)
    return count === 0 ? baseId : `${baseId}-${count + 1}`
  }

  return (
    <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_220px]">
      <article className="min-w-0 max-w-[720px] w-full">
        <div className="mb-10">
          <h1 className="text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-black">
            {doc.title}
          </h1>
        </div>

        <div className="prose-docs">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h2: ({ children }) => <h2 id={nextHeadingId(children)}>{children}</h2>,
              h3: ({ children }) => <h3 id={nextHeadingId(children)}>{children}</h3>,
            }}
          >
            {renderedContent}
          </ReactMarkdown>
        </div>

        <footer className="mt-12 grid gap-4 border-t border-black/[0.08] pt-6 sm:grid-cols-2">
          {prev ? <DocLink doc={prev} direction="prev" /> : <div />}
          {next && <DocLink doc={next} direction="next" />}
        </footer>
      </article>

      <DocToc items={toc} activeId={activeId} onItemClick={handleTocClick} />
    </div>
  )
}

function DocToc({ items, activeId, onItemClick }: { items: TocItem[]; activeId: string; onItemClick: (id: string) => void }) {
  if (items.length === 0) return null

  return (
    <aside className="doc-toc hidden xl:block">
      <div className="sticky top-6 max-h-[calc(100vh-160px)] overflow-y-auto">
        <div className="mb-3 px-3 text-[12px] font-medium uppercase tracking-wider text-black/40">
          本页目录
        </div>
        <nav className="border-l border-transparent">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => onItemClick(item.id)}
              className={`block w-full truncate border-l-2 py-[3px] text-left text-[13.5px] leading-[18px] transition-colors ${
                item.level === 3 ? 'pl-5' : 'pl-3'
              } ${
                activeId === item.id
                  ? 'border-black text-black font-medium'
                  : 'border-transparent text-black/55 hover:text-black/80'
              }`}
            >
              {item.text}
            </button>
          ))}
        </nav>
      </div>
    </aside>
  )
}

function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (typeof node === 'object' && 'props' in node) {
    return nodeText((node as { props?: { children?: ReactNode } }).props?.children)
  }
  return ''
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    || 'section'
}

function DocLink({ doc, direction }: { doc: DocEntry; direction: 'prev' | 'next' }) {
  const isNext = direction === 'next'
  return (
    <Link
      to={`/docs/${doc.path}`}
      className={`group flex items-center gap-3 rounded-lg border border-black/[0.08] bg-white px-4 py-3 text-black/70 transition-colors hover:border-black/[0.15] hover:text-black ${
        isNext ? 'justify-end text-right sm:col-start-2' : ''
      }`}
    >
      {!isNext && <ArrowLeft size={16} strokeWidth={1.8} className="shrink-0 text-black/30 group-hover:text-black" />}
      <span className="min-w-0">
        <span className="block text-[11px] text-black/30">{isNext ? 'Next' : 'Previous'}</span>
        <span className="block truncate text-[14px] font-medium">{doc.title}</span>
      </span>
      {isNext && <ArrowRight size={16} strokeWidth={1.8} className="shrink-0 text-black/30 group-hover:text-black" />}
    </Link>
  )
}
