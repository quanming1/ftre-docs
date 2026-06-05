import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { DocEntry } from '../docs'
import { docLoaders } from '../docs'

export default function DocPage({ doc }: { doc: DocEntry }) {
  const [content, setContent] = useState<string | null>(null)

  useEffect(() => {
    docLoaders[doc.path]().then((mod) => setContent(mod.default))
  }, [doc])

  if (content === null) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-5 h-5 border-2 border-white/20 border-t-accent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <article className="prose-docs">
      <ReactMarkdown>{content}</ReactMarkdown>
    </article>
  )
}
