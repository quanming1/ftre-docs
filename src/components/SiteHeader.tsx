import { BookOpen, Search } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function SiteHeader({ onHero = false }: { onHero?: boolean }) {
  return (
    <header
      className={`relative z-30 flex h-20 w-full items-center ${
        onHero ? 'bg-transparent' : 'border-b border-border-subtle bg-white'
      }`}
    >
      <div className="mx-auto flex w-full max-w-[1720px] items-center justify-between px-8 sm:px-12 lg:px-16">
        <Link to="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/75 text-neon shadow-sm ring-1 ring-black/5 backdrop-blur">
            <BookOpen size={20} strokeWidth={1.9} />
          </div>
          <span className="text-[22px] font-semibold leading-none text-[#101114]">ftre</span>
        </Link>

        <nav className="hidden items-center gap-10 text-[15px] font-medium text-[#101114] md:flex">
          <Link to="/docs/overview">文档</Link>
          <Link to="/#preview">产品</Link>
          <Link to="/docs/plugin-system">插件</Link>
          <Link to="/docs/skill-overview">Skill</Link>
          <Search size={19} strokeWidth={1.8} className="text-[#40444d]" />
        </nav>

        <div className="flex items-center gap-3">
          <button className="hidden h-11 rounded-full bg-black/[0.06] px-6 text-[15px] font-medium text-[#101114] backdrop-blur hover:bg-black/[0.09] sm:block">
            登录
          </button>
          <Link
            to="/docs/overview"
            className="flex h-11 items-center rounded-full bg-black px-6 text-[15px] font-semibold text-white shadow-sm hover:bg-[#15161a]"
          >
            打开文档 ↗
          </Link>
        </div>
      </div>
    </header>
  )
}
