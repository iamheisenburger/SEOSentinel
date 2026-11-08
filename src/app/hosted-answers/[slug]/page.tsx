import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../../../../convex/_generated/api";
import { convexHttp } from "@/lib/convexHttpClient";
import { isHostedAnswersHost, requestHost } from "@/lib/hosted-answers";
import { HostedAnswersShell, safeHttps } from "../shell";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

const getPage = cache(async (host: string, slug: string) => {
  try { return await convexHttp.query(api.answerPublish.hostedPage, { host, slug }); } catch { return null; }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ slug }, host] = await Promise.all([params, requestHost()]);
  if (!isHostedAnswersHost(host)) return { robots: { index: false } };
  const page = await getPage(host, slug);
  if (!page) return { title: "Not found", robots: { index: false } };
  const url = `https://${host}/${slug}`;
  return {
    title: { absolute: page.title },
    description: page.metaDescription,
    alternates: { canonical: url },
    openGraph: { type: "article", title: page.title, description: page.metaDescription, url, siteName: page.business.name },
    twitter: { card: "summary", title: page.title, description: page.metaDescription },
  };
}

export default async function HostedAnswerPage({ params }: Props) {
  const [{ slug }, host] = await Promise.all([params, requestHost()]);
  if (!isHostedAnswersHost(host)) notFound();
  const page = await getPage(host, slug);
  if (!page) notFound();
  const url = `https://${host}/${slug}`;
  const updated = new Date(page.updatedAt);
  const jsonLd = {
    "@context": "https://schema.org", "@type": "Article", headline: page.title, description: page.metaDescription, mainEntityOfPage: url,
    datePublished: new Date(page.publishedAt).toISOString(), dateModified: updated.toISOString(),
    author: { "@type": "Organization", name: page.business.name, url: `https://${page.business.domain}` },
    publisher: { "@type": "Organization", name: page.business.name, url: `https://${page.business.domain}` },
  };
  return (
    <HostedAnswersShell business={page.business}>
      <main>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
        <article>
          <h1>{page.title}</h1>
          <p className="ha-meta">Updated {updated.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
          <div className="ha-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
              a: ({ href, children }) => {
                const safe = safeHttps(href) ?? (href?.startsWith("/") ? href : null);
                return safe ? <a href={safe} {...(safe.startsWith("http") ? { rel: "noopener" } : {})}>{children}</a> : <>{children}</>;
              },
              img: () => null,
            }}>{page.markdown}</ReactMarkdown>
          </div>
          <aside className="ha-cta">
            <p>{page.business.name}</p>
            <a className="ha-button" href={safeHttps(page.business.ctaUrl) ?? `https://${page.business.domain}`}>
              {page.business.ctaText?.trim() || `Visit ${page.business.name}`}
            </a>
          </aside>
        </article>
      </main>
    </HostedAnswersShell>
  );
}
