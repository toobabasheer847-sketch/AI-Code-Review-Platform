import { Link } from 'react-router-dom'

export interface PublicSection {
  heading: string
  body: string[]
}

interface PublicInfoPageProps {
  title: string
  notice: string
  sections: PublicSection[]
}

export function PublicInfoPage({ title, notice, sections }: PublicInfoPageProps): JSX.Element {
  return (
    <main className="min-h-screen bg-[#0f172a] px-6 py-12 text-slate-100">
      <article className="mx-auto max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">{notice}</p>
        <h1 className="mt-3 text-3xl font-semibold">{title}</h1>
        <nav className="mt-4 text-sm text-slate-400">
          <Link to="/" className="hover:text-white">Home</Link>
        </nav>
        <div className="mt-8 space-y-8">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-xl font-semibold">{section.heading}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph} className="mt-2 text-sm leading-6 text-slate-300">{paragraph}</p>
              ))}
            </section>
          ))}
        </div>
      </article>
    </main>
  )
}
