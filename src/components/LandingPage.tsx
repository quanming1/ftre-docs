import { Github, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import SiteHeader from './SiteHeader'

export default function LandingPage() {
  return (
    <main className="bg-white text-black">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#f0f4ff] to-white">
        <div className="flex flex-col items-center px-6 pt-32 pb-24 text-center">
          <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-xl">
            <span className="text-5xl font-bold text-white">f</span>
          </div>

          <h1 className="text-[72px] font-semibold leading-[1.0] tracking-[-0.03em] text-black sm:text-[96px]">
            ftre
          </h1>

          <p className="mt-6 text-[22px] text-black/70">
            你的 AI 编程工作台
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/docs/quickstart"
              className="inline-flex h-[48px] items-center gap-2 rounded-full bg-black px-8 text-[15px] font-medium text-white transition-opacity hover:opacity-85"
            >
              下载 Windows 版
              <ArrowRight size={16} />
            </Link>
          </div>

          <p className="mt-8 text-[14px] text-black/40">
            可用平台：Windows · macOS · Linux
          </p>
        </div>
      </section>

      {/* Trusted by */}
      <section className="border-t border-black/[0.06] px-6 py-16">
        <div className="mx-auto max-w-[1200px] text-center">
          <p className="mb-10 text-[15px] text-black/50">深受开发者信赖</p>
          <div className="flex flex-wrap items-center justify-center gap-12 opacity-60">
            <div className="text-[20px] font-semibold text-black/40">Cisco</div>
            <div className="text-[20px] font-semibold text-black/40">Instacart</div>
            <div className="text-[20px] font-semibold text-black/40">Duolingo</div>
            <div className="text-[20px] font-semibold text-black/40">Vanta</div>
            <div className="text-[20px] font-semibold text-black/40">Virgin Atlantic</div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-32">
        <div className="mx-auto max-w-[1200px]">
          <h2 className="mb-20 text-center text-[48px] font-semibold tracking-[-0.02em] text-black">
            使用 ftre 的方式
          </h2>

          <div className="grid gap-16 md:grid-cols-3">
            {[
              {
                icon: '💬',
                title: '多会话工作区',
                desc: '按 workspace 组织上下文，长任务、排障、实验分支互不打架。'
              },
              {
                icon: '🛠️',
                title: '工具可执行',
                desc: '直接读文件、跑命令、截图、调用浏览器，工具结果进入 agent loop。'
              },
              {
                icon: '🔌',
                title: '插件与 MCP',
                desc: '通过 hooks 和 tools 扩展能力，支持 stdio 和 remote 两种连接方式。'
              },
              {
                icon: '📚',
                title: 'Skill 驱动',
                desc: '把可复用的最佳实践沉淀成 Markdown 技能说明，按需加载。'
              },
              {
                icon: '🔍',
                title: 'Tracing 与回放',
                desc: '完整的 agent → llm → tool 树形 trace，每一步都可回溯。'
              },
              {
                icon: '⚡',
                title: '本地优先',
                desc: '数据留在本地，支持 OpenAI 兼容的任何 API 端点。'
              },
            ].map((item) => (
              <div key={item.title} className="text-left">
                <div className="mb-4 text-4xl">{item.icon}</div>
                <h3 className="text-[22px] font-semibold text-black">{item.title}</h3>
                <p className="mt-3 text-[16px] leading-[1.7] text-black/60">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-black/[0.06] px-6 py-32">
        <div className="mx-auto max-w-[800px] text-center">
          <h2 className="text-[48px] font-semibold tracking-[-0.02em] text-black">
            立即试用 ftre
          </h2>
          <p className="mt-5 text-[18px] text-black/60">
            本地优先的 AI 编程工作台
          </p>
          <div className="mt-10 flex justify-center gap-3">
            <Link
              to="/docs/quickstart"
              className="inline-flex h-[48px] items-center gap-2 rounded-full bg-black px-8 text-[15px] font-medium text-white transition-opacity hover:opacity-85"
            >
              快速开始
              <ArrowRight size={16} />
            </Link>
            <a
              href="https://github.com/quanming1/ftre"
              className="inline-flex h-[48px] items-center gap-2 rounded-full border border-black/[0.15] bg-white px-8 text-[15px] font-medium text-black transition-colors hover:border-black/[0.3]"
            >
              <Github size={16} />
              GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-black/[0.06] px-6 py-12">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-4 text-[14px] text-black/40 md:flex-row md:items-center md:justify-between">
          <div>ftre · 本地优先的 AI 编程工作台</div>
          <div className="flex gap-6">
            <a href="https://github.com/quanming1/ftre" className="hover:text-black/70">GitHub</a>
            <Link to="/docs/overview" className="hover:text-black/70">文档</Link>
            <Link to="/docs/quickstart" className="hover:text-black/70">快速开始</Link>
          </div>
        </div>
      </footer>
    </main>
  )
}
