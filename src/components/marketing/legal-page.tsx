import type { ReactNode } from "react";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/marketing-shell";

/** Privacy and Terms: one readable column, the date it last changed, and links between the two. */
export function LegalPage({
  title,
  updated,
  other,
  children,
}: {
  title: string;
  updated: string;
  other: { label: string; href: string };
  children: ReactNode;
}) {
  return (
    <MarketingShell>
      <article aria-labelledby="legal-title" className="pb-24 pt-[124px] sm:pt-[140px] lg:pb-32 lg:pt-[164px]">
        <div className="container-page">
          <header className="max-w-[680px]">
            <h1 id="legal-title" className="type-h1 text-text">
              {title}
            </h1>
            <p className="mt-4 text-[14px] text-text-3">
              Last updated <time className="mono-label text-text-2">{updated}</time>
              <span aria-hidden="true" className="mx-2 text-text-4">
                ·
              </span>
              <Link href={other.href} className="text-text-2 transition-colors hover:text-text">
                {other.label}
              </Link>
            </p>
          </header>
          <div className="prose-legal mt-10 max-w-[680px] border-t border-border pt-10">{children}</div>
        </div>
      </article>
    </MarketingShell>
  );
}

export function LegalContact() {
  return (
    <div className="rounded-card border border-border bg-surface-1 p-5 text-[14px] leading-6">
      <p className="m-0">
        <strong>Email:</strong> pentrahelp@gmail.com
      </p>
      <p className="m-0">
        <strong>Support:</strong> pentrahelp@gmail.com
      </p>
      <p className="m-0">
        <strong>Phone:</strong> +49 1520 9530880
      </p>
      <p className="m-0">
        <strong>Address:</strong> Pentra Legal Team
      </p>
      <p className="m-0">Kerpener Straße 6, 50170 Kerpen, Germany</p>
    </div>
  );
}
