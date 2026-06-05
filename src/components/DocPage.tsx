import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, ArrowRight, FileText } from 'lucide-react'
import type { DocEntry } from '../docs'
import { docLoaders, docs } from '../docs'

export default function DocPage({ doc }: { doc: DocEntry }) {
  const [content, setContent] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setContent(null)
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

  return (
    <article>
      <div className="mb-7">
        <div className="mb-3 flex items-center gap-2 text-[12px] text-t-ghost">
          <FileText size={14} strokeWidth={1.8} />
          <span>{doc.category}</span>
        </div>
        <h2 className="text-[32px] font-semibold leading-tight text-t-primary sm:text-[40px]">{doc.title}</h2>
      </div>

      <div className="prose-docs">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{renderedContent}</ReactMarkdown>
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
  )
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
