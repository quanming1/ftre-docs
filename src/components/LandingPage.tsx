import { Github } from 'lucide-react'
import { Link } from 'react-router-dom'
import SiteHeader from './SiteHeader'

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-white text-[#101114]">
      <section className="relative min-h-[930px] overflow-hidden">
        <div className="absolute inset-0 hero-atmosphere" />

        <SiteHeader onHero />

        <div className="relative z-10 mx-auto flex min-h-[680px] max-w-[1100px] flex-col items-center justify-center px-8 pb-24 pt-24 text-center">
          <div className="mb-10 flex h-[112px] w-[112px] items-center justify-center rounded-[28px] bg-white/78 shadow-[0_20px_70px_rgba(60,80,210,0.22)] ring-1 ring-white/70 backdrop-blur">
            <div className="flex h-[76px] w-[76px] items-center justify-center rounded-[24px] bg-[linear-gradient(145deg,#8fa7ff,#1f4fff)] text-[42px] font-black text-white shadow-[inset_0_2px_10px_rgba(255,255,255,0.45),0_16px_36px_rgba(31,79,255,0.35)]">
              ›_
            </div>
          </div>

          <h1 className="text-[72px] font-semibold leading-[0.98] tracking-normal text-black sm:text-[92px] lg:text-[108px]">
            ftre
          </h1>
          <p className="mt-8 max-w-[820px] text-[22px] leading-9 text-[#1d2430]">
            本地优先的 AI 编程工作台，把会话、工具、插件、Skill 和自动化集中到一个桌面端。
          </p>

          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link
              to="/docs/quickstart"
              className="flex h-[52px] items-center rounded-full bg-black px-8 text-[18px] font-semibold text-white shadow-sm hover:bg-[#15161a]"
            >
              快速开始 ↗
            </Link>
            <a
              href="#preview"
              className="flex h-[52px] items-center rounded-full bg-white/26 px-8 text-[18px] font-medium text-[#141820] backdrop-blur hover:bg-white/38"
            >
              查看产品界面
            </a>
          </div>

          <div className="mt-10 flex items-center gap-2 text-[16px] text-[#5e6470]">
            <Github size={18} strokeWidth={1.9} />
            <span>Desktop · Gateway · Agent Core</span>
          </div>
        </div>

        <div id="preview" className="absolute bottom-[-185px] left-1/2 z-20 w-[min(1220px,86vw)] -translate-x-1/2">
          <ProductPreview />
        </div>
      </section>

      <section className="bg-white px-8 pb-24 pt-[250px] sm:px-12 lg:px-16">
        <div className="mx-auto grid max-w-[1220px] gap-5 md:grid-cols-3">
          {[
            ['会话工作区', '按 workspace 组织上下文，长任务和多入口会话不会混在一起。'],
            ['插件与工具', '通过 hooks 和 tools 扩展能力，把本地自动化接进 agent loop。'],
            ['Skill 体系', '把可复用能力沉淀成 Markdown 说明，按需加载到当前任务。'],
          ].map(([title, body]) => (
            <div key={title} className="rounded-lg border border-border-subtle bg-white p-6 shadow-sm">
              <h2 className="text-[20px] font-semibold">{title}</h2>
              <p className="mt-3 text-[15px] leading-7 text-t-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

function ProductPreview() {
  return (
    <div className="overflow-hidden rounded-[14px] border border-black/10 bg-white shadow-[0_28px_90px_rgba(35,45,90,0.24)]">
      <div className="flex h-12 items-center border-b border-border-subtle bg-white">
        <div className="flex w-[320px] items-center gap-2 border-r border-border-subtle px-5">
          <span className="h-3 w-3 rounded-full bg-[#ef4444]" />
          <span className="h-3 w-3 rounded-full bg-[#f59e0b]" />
          <span className="h-3 w-3 rounded-full bg-[#22c55e]" />
        </div>
        <div className="flex flex-1 items-center justify-between px-5">
          <span className="text-[14px] font-medium">Create ftre website</span>
          <span className="text-[13px] text-t-ghost">E:/ftre-docs</span>
        </div>
      </div>
      <div className="grid h-[430px] grid-cols-[320px_1fr]">
        <aside className="border-r border-border-subtle bg-base p-4">
          {['官网首页', '文档概览', 'Plugin 系统', 'Skill 使用与加载'].map((item, index) => (
            <div
              key={item}
              className={`mb-2 rounded-full px-4 py-3 text-[14px] ${
                index === 0 ? 'bg-active-doc font-medium text-t-primary' : 'text-t-muted'
              }`}
            >
              {item}
            </div>
          ))}
        </aside>
        <div className="bg-white p-8">
          <div className="mb-7 h-9 w-[360px] rounded bg-panel" />
          <div className="mb-3 h-4 w-full max-w-[720px] rounded bg-panel" />
          <div className="mb-9 h-4 w-full max-w-[560px] rounded bg-panel" />
          <div className="grid gap-4 md:grid-cols-3">
            {['Tools', 'Plugins', 'Skills'].map((title) => (
              <div key={title} className="rounded-lg border border-border-subtle bg-white p-5 shadow-sm">
                <div className="mb-12 h-8 w-8 rounded bg-neon/15" />
                <div className="mb-3 text-[16px] font-semibold">{title}</div>
                <div className="h-3 w-28 rounded bg-panel" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
