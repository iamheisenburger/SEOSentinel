import Link from "next/link";
import type { ReactNode } from "react";
import "./hosted-answers.css";

/** The frame of a hosted answers page: the customer's name and site, never Pentra's branding beyond a small credit. */
export function HostedAnswersShell({ business, children }: {
  business: { name: string; domain: string; ctaText?: string | null; ctaUrl?: string | null }; children: ReactNode;
}) {
  const site = `https://${business.domain}`;
  return (
    <div className="hosted-answers">
      <header className="ha-header">
        <div className="ha-bar">
          <Link className="ha-brand" href="/">{business.name}<span>Answers</span></Link>
          <a className="ha-cta-link" href={safeHttps(business.ctaUrl) ?? site}>{business.ctaText?.trim() || `Visit ${business.name}`}</a>
        </div>
      </header>
      {children}
      <footer>
        <div>
          <span>© {new Date().getFullYear()} {business.name}</span>
          <a href={site}>{business.domain}</a>
        </div>
      </footer>
    </div>
  );
}

export function safeHttps(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try { const url = new URL(raw); return url.protocol === "https:" ? url.href : null; } catch { return null; }
}
