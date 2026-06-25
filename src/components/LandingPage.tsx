import { Github, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import SiteHeader from './SiteHeader'

export default function LandingPage() {
  return (
    <main className="bg-white text-black">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="flex flex-col items-center px-6 pt-24 text-center">
          <div className="mb-20 w-full max-w-[1200px]">
            <WorkbenchPreview />
          </div>

          <h1 className="text-[64px] font-semibold leading-[1.0] tracking-[-0.03em] text-black sm:text-[80px] lg:text-[96px]">
            ftre
          </h1>

          <div className="mt-6 max-w-[600px]">
            <p className="text-[18px] leading-[1.7] text-black/60">
              本地优先的 AI 编程工作台—会话、工具、插件、Skill 和自动化执行，一个桌面端搞定。
            </p>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/docs/quickstart"
              className="inline-flex h-[44px] items-center gap-2 rounded-lg bg-black px-6 text-[14px] font-medium text-white transition-opacity hover:opacity-85"
            >
              快速开始
              <ArrowRight size={15} />
            </Link>
            <a
              href="https://github.com/quanming1/ftre"
              className="inline-flex h-[44px] items-center gap-2 rounded-lg border border-black/[0.12] bg-white px-6 text-[14px] font-medium text-black transition-colors hover:border-black/[0.2]"
            >
              <Github size={15} />
              GitHub
            </a>
          </div>

          <p className="mt-6 pb-28 text-[13px] text-black/40">
            可用平台：Windows · macOS · Linux
          </p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="px-6 py-32">
        <div className="mx-auto max-w-[1200px]">
          <h2 className="mb-20 text-center text-[40px] font-semibold tracking-[-0.02em] text-black sm:text-[52px]">
            为实际工程任务的核心需求而打造
          </h2>

          <div className="space-y-32">
            <FeatureRow
              title="多会话工作区"
              desc="按 workspace 组织上下文，长任务、排障、实验分支互不打架。每个会话拥有独立的记忆和工具状态。"
              gradient="from-blue-100 via-blue-50 to-white"
              reverse
            />
            <FeatureRow
              title="工具可执行"
              desc="不是停在分析阶段，而是直接读文件、跑命令、截图、调用浏览器。工具结果进入 agent loop，形成闭环。"
              gradient="from-purple-100 via-purple-50 to-white"
            />
            <FeatureRow
              title="插件与 MCP 集成"
              desc="通过 hooks 和 tools 扩展能力，把本地自动化和外部服务接进同一个工作台。支持 stdio 和 remote 两种连接方式。"
              gradient="from-emerald-100 via-emerald-50 to-white"
              reverse
            />
            <FeatureRow
              title="Skill 驱动"
              desc="把可复用的最佳实践沉淀成 Markdown 技能说明，按需加载到当前任务。让 agent 在正确的流程里工作。"
              gradient="from-amber-100 via-amber-50 to-white"
            />
            <FeatureRow
              title="Tracing 与回放"
              desc="完整的 agent → llm → tool 树形 trace，JSONL 持久化，前端可视化查看。每一步都可回溯。"
              gradient="from-indigo-100 via-indigo-50 to-white"
              reverse
            />
          </div>
        </div>
      </section>

      {/* Config */}
      <section className="border-t border-black/[0.08] px-6 py-32">
        <div className="mx-auto max-w-[1200px]">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            <div>
              <h2 className="text-[40px] font-semibold tracking-[-0.02em] text-black sm:text-[52px]">
                开箱即用
              </h2>
              <p className="mt-5 max-w-[460px] text-[17px] leading-[1.7] text-black/60">
                几行配置，立刻开始。支持 OpenAI 兼容的任何 API 端点。
              </p>
              <div className="mt-10 space-y-4">
                {[
                  '兼容 OpenAI / DeepSeek / Qwen 等模型',
                  'compact_llm 压缩长上下文',
                  'max_iterations 可调',
                  '工具按模型能力自动 gating',
                ].map((line) => (
                  <div key={line} className="flex items-center gap-3 text-[15px] text-black/70">
                    <span className="h-1.5 w-1.5 rounded-full bg-black/40" />
                    {line}
                  </div>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-black/[0.1] bg-[#f9fafb]">
              <div className="flex items-center gap-2 border-b border-black/[0.08] px-5 py-3">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                <span className="ml-3 text-[13px] text-black/40">config.json</span>
              </div>
              <pre className="overflow-x-auto p-6 text-[14px] leading-7 text-black/80"><code>{`{
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

      {/* Architecture */}
      <section className="border-t border-black/[0.08] px-6 py-32">
        <div className="mx-auto max-w-[1200px]">
          <h2 className="mb-8 text-center text-[40px] font-semibold tracking-[-0.02em] text-black sm:text-[52px]">
            一个工作台，覆盖完整开发流程
          </h2>
          <p className="mb-20 text-center text-[17px] leading-[1.7] text-black/60">
            从问题分析、代码修改、工具执行到验证回看，所有动作发生在同一个界面里。
          </p>

          <div className="grid gap-16 md:grid-cols-3">
            {[
              { title: 'Desktop', desc: 'Electron + React，原生体验', detail: '会话面板 · 模型选择 · Trace 可视化' },
              { title: 'Gateway', desc: 'Python 后端，会话管理 + 工具调度', detail: 'WebSocket · 工具注册 · 插件加载' },
              { title: 'Agent Core', desc: 'ReAct 循环 + LLM 抽象', detail: '事件体系 · 内存管理 · 错误恢复' },
            ].map((item) => (
              <div key={item.title}>
                <h3 className="text-[26px] font-semibold tracking-[-0.02em] text-black">{item.title}</h3>
                <p className="mt-4 text-[17px] leading-[1.7] text-black/60">{item.desc}</p>
                <p className="mt-3 text-[14px] text-black/40">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-black/[0.08] px-6 py-32">
        <div className="mx-auto max-w-[800px] text-center">
          <h2 className="text-[40px] font-semibold tracking-[-0.02em] text-black sm:text-[52px]">
            立即试用 ftre
          </h2>
          <p className="mt-5 text-[17px] leading-[1.7] text-black/60">
            本地优先的 AI 编程工作台
          </p>
          <div className="mt-10 flex justify-center gap-3">
            <Link
              to="/docs/quickstart"
              className="inline-flex h-[44px] items-center gap-2 rounded-lg bg-black px-6 text-[14px] font-medium text-white transition-opacity hover:opacity-85"
            >
              快速开始
              <ArrowRight size={15} />
            </Link>
            <a
              href="https://github.com/quanming1/ftre"
              className="inline-flex h-[44px] items-center gap-2 rounded-lg border border-black/[0.12] bg-white px-6 text-[14px] font-medium text-black transition-colors hover:border-black/[0.2]"
            >
              <Github size={15} />
              GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-black/[0.08] px-6 py-12">
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

function FeatureRow({
  title,
  desc,
  gradient,
  reverse = false,
}: {
  title: string
  desc: string
  gradient: string
  reverse?: boolean
}) {
  const textCol = (
    <div className="flex flex-col justify-center">
      <h3 className="text-[32px] font-semibold tracking-[-0.02em] text-black">{title}</h3>
      <p className="mt-5 max-w-[480px] text-[17px] leading-[1.7] text-black/60">{desc}</p>
    </div>
  )

  const visualCol = (
    <div className="flex items-center justify-center">
      <div className={`h-[440px] w-full rounded-2xl bg-gradient-to-br ${gradient} border border-black/[0.06]`}>
        <div className="flex h-full items-center justify-center">
          <div className="h-20 w-20 rounded-2xl bg-white/60 shadow-sm backdrop-blur-sm" />
        </div>
      </div>
    </div>
  )

  return (
    <div className="grid items-center gap-20 lg:grid-cols-2">
      {reverse ? [visualCol, textCol] : [textCol, visualCol]}
    </div>
  )
}

function WorkbenchPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/[0.1] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
      <div className="flex h-12 items-center justify-between border-b border-black/[0.08] px-5">
        <div className="flex items-center gap-3">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-[13px] text-black/40">ftre workspace</span>
        </div>
        <div className="rounded-lg bg-black/[0.04] px-3 py-1 text-[12px] text-black/40">
          E:/ftre-docs
        </div>
      </div>

      <div className="grid h-[520px] grid-cols-[200px_minmax(0,1fr)_240px]">
        <aside className="border-r border-black/[0.08] bg-[#f9fafb] p-3">
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

        <div className="flex min-w-0 flex-col">
          <div className="border-b border-black/[0.08] px-6 py-4">
            <div className="text-[15px] font-medium text-black/80">重构 docs 首页</div>
            <div className="mt-0.5 text-[12px] text-black/35">agent loop · playwright · screenshot · see_img</div>
          </div>

          <div className="flex-1 space-y-5 px-6 py-6">
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-md bg-black/[0.04] px-4 py-2.5 text-[14px] leading-6 text-black/80">
                把 docs 首页改成 Codex 风格，产品预览放在标题上方。
              </div>
            </div>

            <div className="max-w-[86%]">
              <div className="mb-1.5 flex items-center gap-2 text-[12px] text-black/35">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-black text-[10px] font-semibold text-white">f</div>
                ftre
              </div>
              <div className="rounded-2xl rounded-tl-md border border-black/[0.08] px-4 py-3 text-[14px] leading-6 text-black/70">
                收到。分析 Codex 的设计语言：白底黑字、药丸按钮、大渐变色块、交替排版、无卡片容器。
              </div>
            </div>

            <div className="rounded-xl border border-black/[0.08] bg-[#f9fafb] px-4 py-3">
              <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-purple-600">
                <span className="font-mono">read</span>
              </div>
              <div className="font-mono text-[12px] text-black/45">LandingPage.tsx</div>
            </div>

            <div className="rounded-xl border border-black/[0.08] bg-[#f9fafb] px-4 py-3">
              <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-blue-600">
                <span className="font-mono">write</span>
              </div>
              <div className="font-mono text-[12px] text-black/45">LandingPage.tsx</div>
            </div>

            <div className="max-w-[86%]">
              <div className="mb-1.5 flex items-center gap-2 text-[12px] text-black/35">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-black text-[10px] font-semibold text-white">f</div>
                ftre
              </div>
              <div className="rounded-2xl rounded-tl-md border border-black/[0.08] px-4 py-3 text-[14px] leading-6 text-black/70">
                改好了。产品预览在标题上方，渐变块 440px 高，交替布局，section 间距 128px。
              </div>
            </div>
          </div>

          <div className="border-t border-black/[0.08] p-4">
            <div className="flex items-center gap-3 rounded-xl border border-black/[0.1] bg-white px-4 py-3 text-[14px] text-black/25">
              输入消息，或拖入文件 / 图片 / 链接…
            </div>
          </div>
        </div>

        <aside className="border-l border-black/[0.08] bg-[#f9fafb] p-4">
          <div className="mb-3 text-[11px] uppercase tracking-[0.15em] text-black/30">trace</div>
          <div className="rounded-xl border border-black/[0.08] bg-white p-3">
            <div className="text-[13px] font-medium text-black/70">agent.run</div>
            <div className="mt-3 space-y-2 text-[12px] text-black/40">
              <div className="rounded-lg bg-black/[0.02] px-3 py-2">llm.step → build</div>
              <div className="rounded-lg bg-black/[0.02] px-3 py-2">tool.read → tsx</div>
              <div className="rounded-lg bg-black/[0.02] px-3 py-2">tool.write → tsx</div>
              <div className="rounded-lg bg-black/[0.02] px-3 py-2">screenshot → v6</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
