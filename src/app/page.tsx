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
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-12 text-slate-900">
      <div className="flex flex-col gap-3">
        <p className="text-sm uppercase tracking-[0.25em] text-emerald-600">
          SEO Sentinel
        </p>
        <h1 className="text-3xl font-semibold sm:text-4xl">
          Your personal SEObot, built for your own sites.
        </h1>
        <p className="max-w-2xl text-lg text-slate-600">
          Onboard a domain, generate a content plan, and ship 4–5 optimized
          articles per week with internal linking. Start with Sites, then Plan,
          then Articles.
        </p>
        <div className="flex gap-3">
          <Link
            href="/sites"
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500"
          >
            Start with your site
          </Link>
          <Link
            href="/plan"
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-slate-300 hover:bg-slate-50"
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
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow"
          >
            <h2 className="text-lg font-semibold text-slate-900">
              {card.title}
            </h2>
            <p className="mt-2 text-sm text-slate-600">{card.body}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
