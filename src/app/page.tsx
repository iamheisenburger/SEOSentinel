import Link from "next/link";

const cards = [
  {
    title: "Sites",
    href: "/sites",
    body: "Set your primary domain, tone, language, and cadence.",
  },
  {
    title: "Plan",
    href: "/plan",
    body: "Generate clustered topics and pick what to write next.",
  },
  {
    title: "Articles",
    href: "/articles",
    body: "Generate drafts, review, and get internal link suggestions.",
  },
];

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-900 via-slate-950 to-black text-white">
      <div className="pointer-events-none absolute inset-0 opacity-30 [background:radial-gradient(circle_at_20%_20%,rgba(74,222,128,0.2),transparent_25%),radial-gradient(circle_at_80%_0%,rgba(59,130,246,0.18),transparent_22%),radial-gradient(circle_at_60%_80%,rgba(16,185,129,0.18),transparent_25%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-12 px-6 py-16">
        <div className="flex flex-col gap-4">
          <p className="text-sm uppercase tracking-[0.25em] text-emerald-300/90">
            SEO Sentinel
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
            Your personal SEObot, built for your own sites.
          </h1>
          <p className="max-w-2xl text-lg text-slate-300">
            Onboard a domain, generate a content plan, and ship 4–5 optimized
            articles per week with internal linking. Start with Sites, then Plan,
            then Articles.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/sites"
              className="rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400"
            >
              Start with your site
            </Link>
            <Link
              href="/plan"
              className="rounded-full border border-slate-700/80 px-5 py-2.5 text-sm font-semibold text-white transition hover:border-emerald-400 hover:text-emerald-200"
            >
              View content plan
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group relative overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 shadow-xl shadow-black/30 backdrop-blur transition hover:-translate-y-1 hover:border-emerald-400/60"
            >
              <div className="absolute inset-0 opacity-0 transition group-hover:opacity-20 group-hover:[background:radial-gradient(circle_at_30%_20%,#34d399,transparent_35%)]" />
              <h2 className="text-lg font-semibold text-white">{card.title}</h2>
              <p className="mt-2 text-sm text-slate-300">{card.body}</p>
              <div className="mt-3 text-xs font-semibold text-emerald-300">
                Open →
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
