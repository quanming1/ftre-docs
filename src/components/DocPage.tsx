import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, ArrowRight, FileText } from 'lucide-react'
import type { DocEntry } from '../docs'
import { docLoaders, docs } from '../docs'

export default function DocPage({ doc }: { doc: DocEntry }) {
  const [content, setContent] = useState<string | null>(null)
  const [activeHeading, setActiveHeading] = useState<string>("")

  useEffect(() => {
    let cancelled = false
    setContent(null)
    setActiveHeading("")
    docLoaders[doc.path]().then((mod) => {
      if (!cancelled) setContent(mod.default)
    })
    return () => {
      cancelled = true
    }
  }, [doc])

  const { prev, next } = useMemo(() => {
    const index = docs.findIndex((item) => item.path === doc.path)
    return {
      prev: index > 0 ? docs[index - 1] : null,
      next: index >= 0 && index < docs.length - 1 ? docs[index + 1] : null,
    }
  }, [doc.path])

  useEffect(() => {
    if (content === null) return

    let observer: IntersectionObserver | null = null
    const frame = window.requestAnimationFrame(() => {
      const headings = Array.from(
        document.querySelectorAll<HTMLElement>(".prose-docs h2[id], .prose-docs h3[id]"),
      )

      if (headings.length === 0) return
      setActiveHeading((current) => current || headings[0].id)

      const nextObserver = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)

          if (visible[0]?.target instanceof HTMLElement) {
            setActiveHeading(visible[0].target.id)
          }
        },
        {
          root: document.querySelector("main"),
          rootMargin: "-96px 0px -68% 0px",
          threshold: [0, 1],
        },
      )

      observer = nextObserver
      headings.forEach((heading) => nextObserver.observe(heading))
    })

    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [content, doc.path])

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

  const renderedContent = content.replace(/^#\s+.+(?:\r?\n)+/, '')
  const toc = extractToc(renderedContent)
  const headingCounts = new Map<string, number>()
  const nextHeadingId = (children: ReactNode) => {
    const baseId = slugify(nodeText(children))
    const count = headingCounts.get(baseId) ?? 0
    headingCounts.set(baseId, count + 1)
    return count === 0 ? baseId : `${baseId}-${count + 1}`
  }

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_220px]">
      <article className="min-w-0">
        <div className="mb-7">
          <div className="mb-3 flex items-center gap-2 text-[12px] text-t-ghost">
            <FileText size={14} strokeWidth={1.8} />
            <span>{doc.category}</span>
          </div>
          <h2 className="text-[32px] font-semibold leading-tight text-t-primary sm:text-[40px]">{doc.title}</h2>
        </div>

        <div className="prose-docs">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h2: ({ children }) => (
                <h2 id={nextHeadingId(children)}>{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 id={nextHeadingId(children)}>{children}</h3>
              ),
            }}
          >
            {renderedContent}
          </ReactMarkdown>
        </div>

        <footer className="mt-12 grid gap-3 border-t border-border-subtle pt-6 sm:grid-cols-2">
          {prev ? (
            <DocLink doc={prev} direction="prev" />
          ) : (
            <div />
          )}
          {next && <DocLink doc={next} direction="next" />}
        </footer>
      </article>

      <DocToc items={toc} activeId={activeHeading} />
    </div>
  )
}

interface TocItem {
  id: string
  text: string
  level: 2 | 3
}

function extractToc(markdown: string): TocItem[] {
  const seen = new Map<string, number>()

  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line)
      if (!match) return null
      const text = match[2].replace(/[`*_~[\]()]/g, '').trim()
      const baseId = slugify(text)
      const count = seen.get(baseId) ?? 0
      seen.set(baseId, count + 1)
      return {
        id: count === 0 ? baseId : `${baseId}-${count + 1}`,
        text,
        level: match[1].length as 2 | 3,
      }
    })
    .filter((item): item is TocItem => Boolean(item))
}

function DocToc({ items, activeId }: { items: TocItem[]; activeId: string }) {
  if (items.length === 0) return null

  return (
    <aside className="doc-toc hidden xl:block">
      <div className="sticky top-[112px] max-h-[calc(100vh-128px)] overflow-y-auto border-l border-border-subtle pl-5">
        <div className="mb-3 text-[12px] font-semibold text-t-primary">本页目录</div>
        <nav className="space-y-1">
          {items.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={`block truncate border-l-2 py-0 text-[12px] leading-4 transition-colors hover:text-neon ${
                activeId === item.id
                  ? 'border-neon text-t-primary font-medium'
                  : 'border-transparent text-t-muted'
              } ${
                item.level === 3 ? 'pl-4' : ''
              }`}
            >
              {item.text}
            </a>
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
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  return slug || 'section'
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
