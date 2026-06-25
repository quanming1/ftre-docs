import { Github, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function SiteHeader({ onHero = false }: { onHero?: boolean }) {
  return (
    <header className="flex h-16 w-full items-center border-b border-black/[0.08] bg-white">
      <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-[18px] font-semibold tracking-[-0.02em] text-black">
            ftre
          </span>
        </Link>

        <nav className="hidden items-center gap-8 text-[14px] font-medium md:flex">
          <Link to="/docs/overview" className="text-black/60 transition-colors hover:text-black">文档</Link>
          <a href="#features" className="text-black/60 transition-colors hover:text-black">功能</a>
          <Link to="/docs/plugin-system" className="text-black/60 transition-colors hover:text-black">插件</Link>
          <Link to="/docs/skill" className="text-black/60 transition-colors hover:text-black">Skill</Link>
        </nav>

        <div className="flex items-center gap-3">
          <a
            href="https://github.com/quanming1/ftre"
            className="hidden items-center gap-2 rounded-lg border border-black/[0.12] bg-white px-4 py-2 text-[13px] font-medium text-black/70 transition-colors hover:border-black/[0.2] hover:text-black sm:flex"
          >
            <Github size={14} />
            GitHub
          </a>
          <Link
            to="/docs/quickstart"
            className="rounded-lg bg-black px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-85"
          >
            开始使用
          </Link>
        </div>
      </div>
    </header>
  )
}
