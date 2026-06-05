import { Link } from 'react-router-dom'

export default function SiteHeader({ onHero = false }: { onHero?: boolean }) {
  return (
    <header
      className={`relative z-30 flex h-20 w-full items-center ${
        onHero ? 'bg-transparent' : 'border-b border-border-subtle bg-white'
      }`}
    >
      <div className="mx-auto flex w-full max-w-[1720px] items-center justify-between px-8 sm:px-12 lg:px-16">
        <Link to="/" className="group flex items-center">
          <span className="digital-wordmark">
            Ftre
          </span>
        </Link>

        <nav className="hidden items-center gap-10 text-[15px] font-medium text-[#101114] md:flex">
          <Link to="/docs/overview">文档</Link>
          <Link to="/#preview">产品</Link>
          <Link to="/docs/plugin-system">插件</Link>
          <Link to="/docs/skill-overview">Skill</Link>
        </nav>

        <div className="h-11 w-[156px]" aria-hidden="true" />
      </div>
    </header>
  )
}
