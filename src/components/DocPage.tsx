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
      const containerTop = scrollContainer.getBoundingClientRect().top + 80 // header offset
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
    handleScroll() // initial
    return () => scrollContainer.removeEventListener("scroll", handleScroll)
  }, [toc])

  // 点击 TOC 项 → 平滑滚动到对应标题
  const handleTocClick = useCallback((id: string) => {
    const h = document.getElementById(id)
    if (!h) return
    h.scrollIntoView({ behavior: "auto", block: "start" })
    setActiveId(id)
  }, [])

  if (content === null) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-border-subtle bg-surface px-4 py-2 text-[13px] text-t-muted shadow-sm">
          <span className="h-4 w-4 rounded-full border-2 border-border border-t-neon animate-spin" />
          Loading document
        </div>
      </div>
    )
  }

  // 去掉一级标题（由 DocPage 自己的 title 区替代），留 ## 和 ### 给 markdown 渲染
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
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_240px]">
      <article className="min-w-0 max-w-[688px] w-full">
        <div className="mb-7">

          <h2 className="text-[32px] font-semibold leading-tight text-t-primary sm:text-[40px]">{doc.title}</h2>
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

        <footer className="mt-12 grid gap-3 border-t border-border-subtle pt-6 sm:grid-cols-2">
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
      <div className="sticky top-6 max-h-[calc(100vh-160px)] overflow-y-auto pl-5">
        <nav className="space-y-1">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => onItemClick(item.id)}
              className={`block w-full truncate py-0.5 text-left text-[13px] leading-5 transition-colors hover:text-neon ${
                activeId === item.id
                  ? 'text-neon font-semibold'
                  : 'text-t-muted'
              } ${item.level === 3 ? 'pl-4' : ''}`}
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
      className={`group flex items-center gap-3 rounded-md border border-border-subtle bg-surface px-4 py-3 text-t-secondary shadow-sm transition-colors hover:border-border hover:text-t-primary ${
        isNext ? 'justify-end text-right sm:col-start-2' : ''
      }`}
    >
      {!isNext && <ArrowLeft size={16} strokeWidth={1.8} className="shrink-0 text-t-ghost group-hover:text-neon" />}
      <span className="min-w-0">
        <span className="block text-[11px] text-t-ghost">{isNext ? 'Next' : 'Previous'}</span>
        <span className="block truncate text-[14px] font-medium">{doc.title}</span>
      </span>
      {isNext && <ArrowRight size={16} strokeWidth={1.8} className="shrink-0 text-t-ghost group-hover:text-neon" />}
    </Link>
  )
}