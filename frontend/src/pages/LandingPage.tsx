import { Bug, Shield, Zap, Check } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const FeatureCard = ({ title, desc, icon }: { title: string; desc: string; icon: JSX.Element }): JSX.Element => (
  <div className="rounded-lg bg-[#1e293b]/50 backdrop-blur-md border border-slate-800 hover:border-slate-700 p-6 transform hover:-translate-y-1 transition-all duration-300">
    <div className="flex items-center gap-4">
      <div className="p-3 rounded-md bg-gradient-to-br from-violet-500 to-indigo-500 text-white shadow-[0_8px_30px_rgba(99,102,241,0.12)]">
        {icon}
      </div>
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-slate-400 mt-1">{desc}</p>
      </div>
    </div>
  </div>
)

export default function LandingPage(): JSX.Element {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.15),rgba(255,255,255,0))]">
      <header className="sticky top-0 z-50 bg-[#0f172a]/80 backdrop-blur-md border-b border-slate-800">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="text-white font-bold bg-gradient-to-r from-indigo-600 to-violet-500 px-3 py-2 rounded-md shadow-sm">AI-CodeGuard</div>
              <nav className="hidden md:flex gap-6 text-sm">
                <a href="#features" className="text-slate-400 hover:text-white transition">Features</a>
                <a href="#pricing" className="text-slate-400 hover:text-white transition">Pricing</a>
              </nav>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a href="/login" className="text-slate-400 hover:text-white text-sm transition">Login</a>
            <a href="/register" className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-md text-sm font-medium shadow">Register</a>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-16">
        <section className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-4xl md:text-5xl font-extrabold leading-tight mb-4 bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
              AI-Powered Code Reviews for Smart Developers
            </h1>
            <p className="text-slate-400 text-lg mb-6">Automated code analysis, security checks, and performance suggestions — integrated into your workflow to ship with confidence.</p>

            <div className="flex gap-4">
              <button
                onClick={() => navigate('/register?plan=free')}
                className="px-6 py-3 rounded-md bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white font-medium shadow-lg shadow-indigo-500/20 transition-all"
              >
                Get Started — Free
              </button>

              <button
                onClick={() => navigate('/pricing')}
                className="px-6 py-3 rounded-md border border-slate-800 hover:bg-slate-900 text-slate-300 font-medium transition-all"
              >
                Compare Plans
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg bg-[#1e293b]/50 backdrop-blur-md border border-slate-800 p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-md bg-slate-800/60">
                  <Zap className="text-amber-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">Trusted by engineering teams</p>
                  <h4 className="font-semibold">Continuous, reliable reviews</h4>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-md bg-[#1e293b]/40 p-3 border border-slate-800">
                  <p className="text-sm text-slate-400">Reviews / month</p>
                  <p className="font-bold text-lg">3</p>
                </div>
                <div className="rounded-md bg-[#1e293b]/40 p-3 border border-slate-800">
                  <p className="text-sm text-slate-400">Security</p>
                  <p className="font-bold text-lg">Checks</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FeatureCard title="AI Bug Detection" desc="Catch regressions and fragile logic before they ship." icon={<Bug className="text-violet-400" />} />
              <FeatureCard title="Security Checks" desc="Find vulnerabilities and insecure patterns early." icon={<Shield className="text-emerald-400" />} />
            </div>
            <div>
              <FeatureCard title="Performance Optimization" desc="Recommendations to speed up hot paths." icon={<Zap className="text-amber-400" />} />
            </div>
          </div>
        </section>

        <section id="features" className="mt-16">
          <h2 className="text-2xl font-bold mb-6">Features</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <FeatureCard title="AI Bug Detection" desc="Catch regressions, logic bugs and fragile code with AI-driven rules." icon={<Bug className="text-violet-400" />} />
            <FeatureCard title="Security Checks" desc="Find vulnerabilities and insecure patterns before they reach production." icon={<Shield className="text-emerald-400" />} />
            <FeatureCard title="Performance Optimization" desc="Recommendations to speed up hot paths and reduce resource usage." icon={<Zap className="text-amber-400" />} />
          </div>
        </section>

        <section id="pricing" className="mt-20">
          <h2 className="text-2xl font-bold mb-6">Pricing</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="p-6 rounded-lg bg-[#1e293b]/50 backdrop-blur-md border border-slate-800 hover:border-slate-700">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold">Free</h3>
                  <p className="text-slate-400">$0 / month</p>
                </div>
                <div className="text-sm text-slate-400">Popular</div>
              </div>

              <ul className="mt-4 space-y-3 text-sm text-slate-300">
                <li className="flex items-center gap-3"><Check className="text-emerald-400" /> 3 code reviews / month</li>
                <li className="flex items-center gap-3"><Check className="text-emerald-400" /> Community support</li>
              </ul>

              <div className="mt-6">
                <button
                  onClick={() => navigate('/register?plan=free')}
                  className="w-full py-3 rounded-md border border-slate-800 text-slate-200 hover:bg-slate-900 transition"
                >
                  Get Started (Free)
                </button>
              </div>
            </div>

            <div className="p-6 rounded-lg bg-[#1e293b]/60 backdrop-blur-md border border-indigo-500/50 shadow-lg shadow-indigo-500/10 transform hover:-translate-y-1 transition-all">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold">Pro</h3>
                  <p className="text-slate-400">$19 / month</p>
                </div>
                <div className="text-sm text-indigo-200 bg-purple-700/30 px-2 py-1 rounded-full">Most Popular</div>
              </div>

              <ul className="mt-4 space-y-3 text-sm text-slate-200">
                <li className="flex items-center gap-3"><Check className="text-emerald-400" /> Unlimited code reviews</li>
                <li className="flex items-center gap-3"><Check className="text-emerald-400" /> Advanced metrics</li>
                <li className="flex items-center gap-3"><Check className="text-emerald-400" /> Faster analysis</li>
              </ul>

              <div className="mt-6">
                <button
                  onClick={() => navigate('/register?plan=pro')}
                  className="w-full py-3 rounded-md bg-gradient-to-r from-indigo-500 to-blue-600 text-white font-medium shadow-lg shadow-indigo-500/20 transition-all"
                >
                  Start Pro — $19/mo
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
