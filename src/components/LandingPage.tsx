import { ArrowRight, Github } from 'lucide-react'
import { Link } from 'react-router-dom'
import SiteHeader from './SiteHeader'

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-white text-black">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <SiteHeader onHero />

        <div className="mx-auto max-w-[1200px] px-6 pb-16 pt-32 lg:pt-40">
          <h1
            className="text-[56px] font-medium leading-[1.0] tracking-[-0.04em] text-black sm:text-[72px] lg:text-[88px]"
            style={{ letterSpacing: '-0.035em' }}
          >
            ftre
          </h1>

          <p className="mt-6 max-w-[560px] text-[17px] leading-[28px] text-black/70">
            本地优先的 AI 编程工作台 — 会话、工具、插件、Skill 和自动化执行，一个桌面端搞定。
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/docs/quickstart"
              className="inline-flex h-[40px] items-center gap-2 rounded-full bg-black px-5 text-[14px] font-medium text-white transition-opacity hover:opacity-85"
            >
              快速开始
              <ArrowRight size={15} />
            </Link>
            <a
              href="https://github.com/quanming1/ftre"
              className="inline-flex h-[40px] items-center gap-2 rounded-full bg-black/[0.04] px-5 text-[14px] font-medium text-black transition-colors hover:bg-black/[0.08]"
            >
              <Github size={15} />
              GitHub
            </a>
          </div>

          <p className="mt-4 text-[13px] text-black/40">
            可用平台：Windows · macOS · Linux
          </p>
        </div>

        {/* Product preview — full bleed */}
        <div className="border-t border-black/[0.06]">
          <WorkbenchPreview />
        </div>
      </section>

      {/* Features — no cards, just content with gradient accents */}
      <section className="border-t border-black/[0.06]">
        <div className="mx-auto max-w-[1200px] px-6 py-24">
          <h2
            className="text-[36px] font-medium tracking-[-0.03em] text-black sm:text-[48px]"
            style={{ letterSpacing: '-0.03em' }}
          >
            为实际工程任务的核心需求而打造
          </h2>

          <div className="mt-16 space-y-20">
            {/* Feature 1 */}
            <FeatureRow
              title="多会话工作区"
              desc="按 workspace 组织上下文，长任务、排障、实验分支互不打架。每个会话拥有独立的记忆和工具状态。"
              gradient="from-blue-100 to-cyan-50"
            />
            {/* Feature 2 */}
            <FeatureRow
              title="工具可执行"
              desc="不是停在分析阶段，而是直接读文件、跑命令、截图、调用浏览器。工具结果进入 agent loop，形成闭环。"
              gradient="from-purple-100 to-pink-50"
            />
            {/* Feature 3 */}
            <FeatureRow
              title="插件与 MCP 集成"
              desc="通过 hooks 和 tools 扩展能力，把本地自动化和外部服务接进同一个工作台。支持 stdio 和 remote 两种连接方式。"
              gradient="from-emerald-100 to-teal-50"
            />
            {/* Feature 4 */}
            <FeatureRow
              title="Skill 驱动"
              desc="把可复用的最佳实践沉淀成 Markdown 技能说明，按需加载到当前任务。让 agent 在正确的流程里工作。"
              gradient="from-amber-100 to-orange-50"
            />
            {/* Feature 5 */}
            <FeatureRow
              title="Tracing 与回放"
              desc="完整的 agent → llm → tool 树形 trace，JSONL 持久化，前端可视化查看。每一步都可回溯。"
              gradient="from-indigo-100 to-blue-50"
            />
          </div>
        </div>
      </section>

      {/* Multi-surface section */}
      <section className="border-t border-black/[0.06] bg-black/[0.015]">
        <div className="mx-auto max-w-[1200px] px-6 py-24">
          <h2
            className="text-[36px] font-medium tracking-[-0.03em] text-black sm:text-[48px]"
            style={{ letterSpacing: '-0.03em' }}
          >
            一个工作台，覆盖完整开发流程
          </h2>
          <p className="mt-4 max-w-[520px] text-[17px] leading-[28px] text-black/60">
            从问题分析、代码修改、工具执行到验证回看，所有动作发生在同一个界面里。
          </p>

          <div className="mt-16 grid gap-12 md:grid-cols-3">
            {[
              { title: '桌面端', desc: 'Electron + React，原生体验', detail: '会话面板 · 模型选择 · Trace 可视化' },
              { title: 'Gateway', desc: 'Python 后端，会话管理 + 工具调度', detail: 'WebSocket · 工具注册 · 插件加载' },
              { title: 'Agent Core', desc: 'ReAct 循环 + LLM 抽象', detail: '事件体系 · 内存管理 · 错误恢复' },
            ].map((item) => (
              <div key={item.title}>
                <h3 className="text-[24px] font-medium tracking-[-0.02em] text-black">{item.title}</h3>
                <p className="mt-3 text-[17px] leading-[28px] text-black/60">{item.desc}</p>
                <p className="mt-2 text-[14px] text-black/40">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Code config section */}
      <section className="border-t border-black/[0.06]">
        <div className="mx-auto max-w-[1200px] px-6 py-24">
          <div className="grid gap-16 lg:grid-cols-[1fr_1fr] lg:items-center">
            <div>
              <h2
                className="text-[36px] font-medium tracking-[-0.03em] text-black sm:text-[48px]"
                style={{ letterSpacing: '-0.03em' }}
              >
                开箱即用
              </h2>
              <p className="mt-4 max-w-[440px] text-[17px] leading-[28px] text-black/60">
                几行配置，立刻开始。支持 OpenAI 兼容的任何 API 端点。
              </p>
              <div className="mt-8 space-y-3">
                {['兼容 OpenAI / DeepSeek / Qwen 等模型', 'compact_llm 压缩长上下文', 'max_iterations 可调', '工具按模型能力自动 gating'].map((line) => (
                  <div key={line} className="flex items-center gap-3 text-[15px] text-black/70">
                    <span className="h-1.5 w-1.5 rounded-full bg-black/30" />
                    {line}
                  </div>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-black/[0.08] bg-[#fafafa]">
              <div className="flex items-center gap-2 border-b border-black/[0.06] px-5 py-3">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                <span className="ml-3 text-[13px] text-black/40">config.json</span>
              </div>
              <pre className="overflow-x-auto px-5 py-5 text-[14px] leading-7 text-black/80"><code>{`{
  "llm": {
    "model": "deepseek-chat",
    "api_base": "https://api.deepseek.com",
    "api_key": "sk-..."
  },
  "compact_generation": true,
  "max_iterations": 10
}`}</code></pre>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-black/[0.06]">
        <div className="mx-auto max-w-[1200px] px-6 py-24 text-center">
          <h2
            className="text-[36px] font-medium tracking-[-0.03em] text-black sm:text-[48px]"
            style={{ letterSpacing: '-0.03em' }}
          >
            立即试用 ftre
          </h2>
          <p className="mt-4 text-[17px] leading-[28px] text-black/60">
            本地优先的 AI 编程工作台
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link
              to="/docs/quickstart"
              className="inline-flex h-[40px] items-center gap-2 rounded-full bg-black px-5 text-[14px] font-medium text-white transition-opacity hover:opacity-85"
            >
              快速开始
              <ArrowRight size={15} />
            </Link>
            <a
              href="https://github.com/quanming1/ftre"
              className="inline-flex h-[40px] items-center gap-2 rounded-full bg-black/[0.04] px-5 text-[14px] font-medium text-black transition-colors hover:bg-black/[0.08]"
            >
              <Github size={15} />
              GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-black/[0.06]">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-6 py-10 text-[14px] text-black/40 md:flex-row md:items-center md:justify-between">
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

function FeatureRow({ title, desc, gradient }: { title: string; desc: string; gradient: string }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
      <div>
        <h3 className="text-[30px] font-medium tracking-[-0.02em] text-black">{title}</h3>
        <p className="mt-4 max-w-[440px] text-[17px] leading-[28px] text-black/60">{desc}</p>
      </div>
      {/* Gradient visual — like OpenAI's soft gradient images */}
      <div className={`h-[240px] rounded-2xl bg-gradient-to-br ${gradient}`}>
        <div className="flex h-full items-center justify-center">
          <div className="h-20 w-20 rounded-3xl bg-white/60 shadow-sm backdrop-blur-sm" />
        </div>
      </div>
    </div>
  )
}

function WorkbenchPreview() {
  return (
    <div className="mx-auto max-w-[1200px] px-6 py-16">
      <div className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-[0_20px_80px_rgba(0,0,0,0.06)]">
        {/* Title bar */}
        <div className="flex h-12 items-center justify-between border-b border-black/[0.06] px-5">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
            <span className="ml-3 text-[13px] text-black/40">ftre workspace</span>
          </div>
          <div className="rounded-full bg-black/[0.04] px-3 py-1 text-[12px] text-black/40">
            E:/ftre-docs
          </div>
        </div>

        {/* Three-pane layout */}
        <div className="grid h-[520px] grid-cols-[200px_minmax(0,1fr)_240px]">
          {/* Sessions sidebar */}
          <aside className="border-r border-black/[0.06] bg-[#fafafa] p-3">
            <div className="mb-3 px-2 text-[11px] uppercase tracking-[0.15em] text-black/30">sessions</div>
            {[
              { name: '重构 docs 首页', active: true },
              { name: '排查 DeepSeek 502', active: false },
              { name: '优化 tracing 面板', active: false },
              { name: '清理 MCP 配置', active: false },
            ].map((s) => (
              <div
                key={s.name}
                className={`mb-1 rounded-lg px-3 py-2.5 text-[13px] transition-colors ${
                  s.active
                    ? 'bg-black/[0.06] font-medium text-black'
                    : 'text-black/40 hover:bg-black/[0.03] hover:text-black/60'
                }`}
              >
                {s.name}
              </div>
            ))}
          </aside>

          {/* Chat area */}
          <div className="flex min-w-0 flex-col">
            <div className="border-b border-black/[0.06] px-6 py-4">
              <div className="text-[15px] font-medium text-black/80">重构 docs 首页</div>
              <div className="mt-0.5 text-[12px] text-black/35">agent loop · playwright · screenshot · see_img</div>
            </div>

            <div className="flex-1 space-y-5 px-6 py-6">
              {/* User message */}
              <div className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-black/[0.04] px-4 py-2.5 text-[14px] leading-6 text-black/80">
                  把 docs 首页改成更像产品官网，不要模板味。
                </div>
              </div>

              {/* Assistant */}
              <div className="max-w-[86%]">
                <div className="mb-1.5 flex items-center gap-2 text-[12px] text-black/35">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-black text-[10px] font-semibold text-white">f</div>
                  ftre
                </div>
                <div className="rounded-2xl rounded-tl-md border border-black/[0.06] px-4 py-3 text-[14px] leading-6 text-black/70">
                  收到。我先看现有 LandingPage 和全局样式，再重做首屏信息结构。
                </div>
              </div>

              {/* Tool call */}
              <div className="rounded-xl border border-black/[0.06] bg-[#fafafa] px-4 py-3">
                <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-purple-600">
                  <span className="font-mono">read</span>
                </div>
                <div className="font-mono text-[12px] text-black/45">src/components/LandingPage.tsx</div>
              </div>

              {/* Tool call 2 */}
              <div className="rounded-xl border border-black/[0.06] bg-[#fafafa] px-4 py-3">
                <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-blue-600">
                  <span className="font-mono">write</span>
                </div>
                <div className="font-mono text-[12px] text-black/45">src/components/LandingPage.tsx</div>
              </div>

              {/* Assistant continues */}
              <div className="max-w-[86%]">
                <div className="mb-1.5 flex items-center gap-2 text-[12px] text-black/35">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-black text-[10px] font-semibold text-white">f</div>
                  ftre
                </div>
                <div className="rounded-2xl rounded-tl-md border border-black/[0.06] px-4 py-3 text-[14px] leading-6 text-black/70">
                  首屏已切到白底黑字、药丸按钮、无卡片的风格，对齐 OpenAI 官网的视觉语言。接下来继续截图看效果。
                </div>
              </div>
            </div>

            {/* Input */}
            <div className="border-t border-black/[0.06] p-4">
              <div className="flex items-center gap-3 rounded-xl border border-black/[0.08] bg-white px-4 py-3 text-[14px] text-black/25">
                输入消息，或拖入文件 / 图片 / 链接…
              </div>
            </div>
          </div>

          {/* Trace panel */}
          <aside className="border-l border-black/[0.06] bg-[#fafafa] p-4">
            <div className="mb-3 text-[11px] uppercase tracking-[0.15em] text-black/30">trace</div>
            <div className="rounded-xl border border-black/[0.06] bg-white p-3">
              <div className="text-[13px] font-medium text-black/70">agent.run</div>
              <div className="mt-3 space-y-2 text-[12px] text-black/40">
                <div className="rounded-lg bg-black/[0.02] px-3 py-2">llm.step → build response</div>
                <div className="rounded-lg bg-black/[0.02] px-3 py-2">tool.read → LandingPage.tsx</div>
                <div className="rounded-lg bg-black/[0.02] px-3 py-2">tool.write → LandingPage.tsx</div>
                <div className="rounded-lg bg-black/[0.02] px-3 py-2">browser.screenshot → v5.png</div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
