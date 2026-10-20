import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { LandingNav } from "@/components/layout/landing-nav";
import { FreeCheckResult } from "@/components/free-check/check-result";
import { freeCheckDomain } from "../../../../convex/lib/missedSearches";

type FreeCheckResultPageProps = { params: Promise<{ domain: string }> };

function requestedDomain(raw: string): { raw: string; domain: string | null } {
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* keep the raw segment */ }
  return { raw: decoded, domain: freeCheckDomain(decoded) };
}

// A result page is shareable but never indexed: its content is one site's data.
export async function generateMetadata({ params }: FreeCheckResultPageProps): Promise<Metadata> {
  const { domain } = requestedDomain((await params).domain);
  return {
    title: domain ? `Missed Google searches for ${domain}` : "Free SEO check",
    description: domain ? `The Google searches ${domain}'s customers make that it has no page for, from Pentra's free SEO checker.` : undefined,
    robots: { index: false, follow: false },
  };
}

export default async function FreeCheckResultPage({ params }: FreeCheckResultPageProps) {
  const { raw, domain } = requestedDomain((await params).domain);
  if (!domain) notFound();
  if (raw !== domain) permanentRedirect(`/check/${domain}`);
  return (
    <main className="relative min-h-screen">
      <LandingNav />
      <div className="mx-auto w-full max-w-3xl px-6 pt-28 pb-24 md:pt-36">
        <FreeCheckResult domain={domain} />
      </div>
    </main>
  );
}
