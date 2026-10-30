import type { Metadata } from "next";
import { pageSocial } from "@/lib/page-social";
import Link from "next/link";
import { LandingNav } from "@/components/layout/landing-nav";
import { FreeCheckForm } from "@/components/free-check/check-form";

export const metadata: Metadata = {
  title: "Free SEO checker: the Google searches your site is missing",
  description: "Free SEO checker: see the real Google searches your customers make that your website has no page for, the ones you're close on, and the basics Google needs. No signup.",
  alternates: { canonical: "https://pentra.dev/check" },
  ...pageSocial("Free SEO checker | Pentra", "See the real Google searches your customers make that your website has no page for. No signup.", "https://pentra.dev/check"),
};

const WRAP = "mx-auto w-full max-w-[1100px] px-6";
const EYEBROW = "font-mono text-[12px] uppercase tracking-[0.12em] text-[#62666D]";

const SHOWS = [
  ["Missed searches", "Real searches with monthly volume, made by people who could buy from you, where your site has no page and isn't on Google's first two pages. Only searches with low competition, so a smaller site can win them. Pages you already have that Google doesn't show are listed separately."],
  ["Close to page one", "Searches you already show up for at positions 4 to 20. Improving the page that ranks is usually the fastest way to more visitors."],
  ["Google basics", "Whether Google can crawl and understand your homepage: robots.txt, sitemap, title, description, headings, canonical address, structured data and more."],
] as const;

const HOW = [
  "Pentra reads your homepage to learn what you sell and who you sell to.",
  "It looks up real search demand and competition for your market in Google data, through DataForSEO.",
  "It keeps the searches your customers make and drops the ones your site already covers or ranks for.",
] as const;

const FAQ = [
  ["Is the SEO check really free?", "Yes. The check is free and needs no account. Each website's result is kept for 7 days, so you can share its link. To see every missed search, create a free Pentra account."],
  ["Where do the numbers come from?", "Monthly searches and competition come from Google data through DataForSEO, for the country your website targets. Pentra never invents a search: every one has measured demand."],
  ["Does it work for a local business?", "Yes. When your homepage shows you serve particular cities or areas, Pentra checks the searches that name them, like \"ac repair austin\", because a country-wide search isn't your customers' and isn't one a local page can win."],
  ["What does competition mean?", "How hard it is to reach Google's first page for a search, on a 0 to 100 scale. The check shows searches up to 30, which a smaller website can realistically win with one good page."],
  ["What happens if I sign up?", "Pentra starts with the missed searches from your check, checked against the business facts you confirm. It learns what you sell, writes fact-checked articles for those searches and publishes them to your site (a Next.js, Astro, Hugo, Jekyll or Gatsby blog on GitHub, or you paste them in). Then it improves the pages closest to page one. The free plan includes 3 articles a month, with no credit card."],
  ["Does the check change my website?", "No. It only reads your public pages, the way Google does."],
] as const;

const schema = [
  { "@context": "https://schema.org", "@type": "WebApplication", name: "Pentra Missed Searches Checker", url: "https://pentra.dev/check",
    applicationCategory: "BusinessApplication", operatingSystem: "Web", isAccessibleForFree: true,
    description: "Find the Google searches your customers make that your website has no page for.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, publisher: { "@type": "Organization", name: "Pentra", url: "https://pentra.dev" } },
  { "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: FAQ.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) },
];

export default function FreeCheckPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <LandingNav />
      <section className="relative pt-32 pb-20 md:pt-44 md:pb-28">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 left-1/2 h-[400px] w-[700px] -translate-x-1/2 rounded-full bg-[#0EA5E9]/[0.04] blur-[120px]" />
        </div>
        <div className={`${WRAP} relative`}>
          <p className={EYEBROW}>Free SEO checker</p>
          <h1 className="mt-5 max-w-[18ch] text-[clamp(2.3rem,5.6vw,4.2rem)] font-semibold leading-[1.04] tracking-[-0.035em] [text-wrap:balance]">
            Which Google searches is your website missing?
          </h1>
          <p className="mt-6 max-w-[40rem] text-[17px] leading-relaxed text-[#8A8F98] md:text-[19px] [text-wrap:pretty]">
            Enter your website. Pentra finds the real searches your customers make that your site has no page for,
            the ones you&apos;re close on, and the basics Google needs to show you. It takes about a minute.
          </p>
          <div className="mt-9"><FreeCheckForm autoFocus /></div>
        </div>
      </section>

      <section className="border-t border-white/[0.06] py-20">
        <div className={WRAP}>
          <p className={EYEBROW}>What the check shows</p>
          <div className="mt-8 grid gap-10 md:grid-cols-3">
            {SHOWS.map(([title, body]) => <div key={title}>
              <h2 className="text-[17px] font-semibold text-[#F7F8F8]">{title}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-[#8A8F98]">{body}</p>
            </div>)}
          </div>
        </div>
      </section>

      <section className="border-t border-white/[0.06] py-20">
        <div className={`${WRAP} grid gap-10 md:grid-cols-[1fr_1.4fr]`}>
          <div>
            <p className={EYEBROW}>How it works</p>
            <h2 className="mt-4 text-[26px] font-semibold tracking-tight text-[#F7F8F8]">Real searches, never invented ones</h2>
          </div>
          <ol className="space-y-5">
            {HOW.map((step, i) => <li key={step} className="flex gap-4 text-[15px] leading-relaxed text-[#C9CDD6]">
              <span className="font-mono text-[13px] text-[#62666D]">0{i + 1}</span>{step}
            </li>)}
          </ol>
        </div>
      </section>

      <section className="border-t border-white/[0.06] py-20">
        <div className={`${WRAP} max-w-[820px]`}>
          <h2 className="text-[26px] font-semibold tracking-tight text-[#F7F8F8]">Questions</h2>
          <dl className="mt-8 divide-y divide-white/[0.06]">
            {FAQ.map(([question, answer]) => <div key={question} className="py-5">
              <dt className="text-[16px] font-medium text-[#F7F8F8]">{question}</dt>
              <dd className="mt-2 text-[15px] leading-relaxed text-[#8A8F98]">{answer}</dd>
            </div>)}
          </dl>
          <p className="mt-10 text-[15px] text-[#8A8F98]">
            Want Pentra to write those pages for you? <Link href="/sign-up" className="text-[#D0D6E0] underline decoration-white/20 underline-offset-4 hover:text-white">Start free</Link>
            {" "}or <Link href="/" className="text-[#D0D6E0] underline decoration-white/20 underline-offset-4 hover:text-white">see how Pentra works</Link>.
          </p>
        </div>
      </section>
    </main>
  );
}
