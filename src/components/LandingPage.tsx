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

      {/* Product Preview */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-[1200px]">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            <div>
              <h2 className="text-[40px] font-semibold tracking-[-0.02em] text-black">
                服务于开发者的日常工作
              </h2>
              <p className="mt-5 text-[18px] leading-[1.7] text-black/60">
                你可以将 ftre 应用于：代码重构、Bug 修复、文档生成、自动化测试、代码审查、依赖升级、以及日常开发任务。
              </p>
            </div>

            <div className="overflow-hidden rounded-2xl border border-black/[0.1] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
              <div className="flex h-10 items-center justify-between border-b border-black/[0.08] px-4">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                </div>
                <div className="text-[12px] text-black/40">ftre workspace</div>
              </div>

              <div className="grid h-[400px] grid-cols-[180px_minmax(0,1fr)]">
                <aside className="border-r border-black/[0.08] bg-[#f9fafb] p-3">
                  <div className="mb-2 px-2 text-[10px] uppercase tracking-[0.15em] text-black/30">sessions</div>
                  {[
                    { name: '重构 docs 首页', active: true },
                    { name: '排查 502 错误', active: false },
                    { name: '优化 tracing', active: false },
                  ].map((s) => (
                    <div
                      key={s.name}
                      className={`mb-1 rounded-lg px-3 py-2 text-[12px] ${
                        s.active
                          ? 'bg-black/[0.06] font-medium text-black'
                          : 'text-black/40'
                      }`}
                    >
                      {s.name}
                    </div>
                  ))}
                </aside>

                <div className="flex min-w-0 flex-col">
                  <div className="border-b border-black/[0.08] px-5 py-3">
                    <div className="text-[14px] font-medium text-black/80">重构 docs 首页</div>
                  </div>

                  <div className="flex-1 space-y-4 px-5 py-5">
                    <div className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-black/[0.04] px-3 py-2 text-[13px] text-black/80">
                        把 docs 首页改成 Codex 风格
                      </div>
                    </div>

                    <div className="max-w-[86%]">
                      <div className="mb-1 flex items-center gap-2 text-[11px] text-black/35">
                        <div className="flex h-4 w-4 items-center justify-center rounded-full bg-black text-[9px] font-semibold text-white">f</div>
                        ftre
                      </div>
                      <div className="rounded-2xl rounded-tl-md border border-black/[0.08] px-3 py-2.5 text-[13px] text-black/70">
                        收到。分析 Codex 的设计语言：白底黑字、大标题、渐变背景。
                      </div>
                    </div>

                    <div className="rounded-lg border border-black/[0.08] bg-[#f9fafb] px-3 py-2">
                      <div className="mb-1 text-[11px] font-medium text-purple-600">read</div>
                      <div className="font-mono text-[11px] text-black/45">LandingPage.tsx</div>
                    </div>

                    <div className="rounded-lg border border-black/[0.08] bg-[#f9fafb] px-3 py-2">
                      <div className="mb-1 text-[11px] font-medium text-blue-600">write</div>
                      <div className="font-mono text-[11px] text-black/45">LandingPage.tsx</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Gradient Feature Block */}
      <section className="bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 px-6 py-32">
        <div className="mx-auto max-w-[1200px]">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            <div className="order-2 lg:order-1">
              <div className="overflow-hidden rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur-sm">
                <div className="mb-4 text-[12px] uppercase tracking-[0.15em] text-white/60">trace</div>
                <div className="rounded-xl border border-white/20 bg-white/5 p-4">
                  <div className="text-[14px] font-medium text-white">agent.run</div>
                  <div className="mt-3 space-y-2 text-[12px] text-white/60">
                    <div className="rounded-lg bg-white/10 px-3 py-2">llm.step → build</div>
                    <div className="rounded-lg bg-white/10 px-3 py-2">tool.read → tsx</div>
                    <div className="rounded-lg bg-white/10 px-3 py-2">tool.write → tsx</div>
                    <div className="rounded-lg bg-white/10 px-3 py-2">screenshot → v6</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <h2 className="text-[40px] font-semibold tracking-[-0.02em] text-white">
                完整的 Tracing 与回放
              </h2>
              <p className="mt-5 text-[18px] leading-[1.7] text-white/80">
                从问题分析、代码修改、工具执行到验证回看，所有动作都有完整的 trace 记录。每一步都可回溯，每个决策都可解释。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
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
                icon: '',
                title: '插件与 MCP',
                desc: '通过 hooks 和 tools 扩展能力，支持 stdio 和 remote 两种连接方式。'
              },
              {
                icon: '📚',
                title: 'Skill 驱动',
                desc: '把可复用的最佳实践沉淀成 Markdown 技能说明，按需加载。'
              },
              {
                icon: '',
                title: '本地优先',
                desc: '数据留在本地，支持 OpenAI 兼容的任何 API 端点。'
              },
              {
                icon: '🔍',
                title: '上下文压缩',
                desc: '自动压缩长对话，保留关键信息，让 agent 持续高效工作。'
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

      {/* Multi-platform */}
      <section className="border-t border-black/[0.06] px-6 py-32">
        <div className="mx-auto max-w-[1200px] text-center">
          <h2 className="text-[48px] font-semibold tracking-[-0.02em] text-black">
            在各个编码场景中使用同一智能体
          </h2>
          <p className="mt-5 text-[18px] text-black/60">
            在多个平台和入口中使用 ftre，实现统一联动。
          </p>

          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {[
              {
                title: 'Desktop',
                desc: '完整的 GUI 体验',
                gradient: 'from-blue-400 to-purple-500',
              },
              {
                title: 'CLI',
                desc: '终端直接调用',
                gradient: 'from-purple-400 to-pink-500',
              },
              {
                title: 'API',
                desc: '集成到你的工具链',
                gradient: 'from-indigo-400 to-blue-500',
              },
            ].map((item) => (
              <div key={item.title} className={`overflow-hidden rounded-2xl bg-gradient-to-br ${item.gradient} p-8`}>
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
                  <span className="text-2xl font-bold text-white">{item.title[0]}</span>
                </div>
                <h3 className="text-[24px] font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-[15px] text-white/80">{item.desc}</p>
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
