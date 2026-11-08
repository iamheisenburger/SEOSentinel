"use client";

import Link from "next/link";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check, ChevronsUpDown, CreditCard, FileText, LayoutDashboard, Menu, MessageSquareText, Quote, Settings, Users, X,
} from "lucide-react";
import { Wordmark } from "@/components/marketing/wordmark";
import { SourceGlyph } from "@/components/ui/evidence-card";
import { useAnswersQuery, useAppHref } from "@/lib/answers/backend";
import type { AnswersAccess, MySite } from "@/lib/answers/types";
import { cx } from "@/lib/cx";

export const ANSWERS_NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/questions", label: "Questions", icon: MessageSquareText },
  { href: "/dashboard/pages", label: "Answer pages", icon: FileText },
  { href: "/dashboard/citations", label: "Citations", icon: Quote },
  { href: "/dashboard/competitors", label: "Competitors", icon: Users },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
] as const;

const PLAN_LABEL: Record<AnswersAccess, string> = { owner: "Pentra's own site · never billed", paid: "Pentra plan", free: "Free snapshot" };

/**
 * The Answers dashboard's sidebar: the site switcher, seven destinations, and the plan and account at the bottom.
 * 240px, surface-1, fixed; on phones it slides in from a top bar. It never animates between pages.
 */
export function AnswersSidebar({ sites, activeSiteId, onSelectSite, pathname, account }: {
  sites: MySite[];
  activeSiteId: string | null;
  onSelectSite: (siteId: string) => void;
  pathname: string;
  account: ReactNode;
}) {
  const href = useAppHref();
  const [mobileOpen, setMobileOpen] = useState(false);
  const active = sites.find((s) => s.siteId === activeSiteId) ?? null;
  const isActive = (item: (typeof ANSWERS_NAV)[number]) => {
    const target = href(item.href);
    return "exact" in item && item.exact ? pathname === target : pathname === target || pathname.startsWith(`${target}/`);
  };

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-[rgba(8,9,10,0.88)] px-4 backdrop-blur-[20px] lg:hidden">
        <button type="button" onClick={() => setMobileOpen((v) => !v)} aria-label={mobileOpen ? "Close menu" : "Open menu"} aria-expanded={mobileOpen}
          className="inline-flex h-9 w-9 items-center justify-center rounded-control border border-border text-text-2 transition-colors hover:bg-surface-2 hover:text-text">
          {mobileOpen ? <X className="h-4 w-4" strokeWidth={1.5} /> : <Menu className="h-4 w-4" strokeWidth={1.5} />}
        </button>
        <Wordmark href={href("/dashboard")} />
        {active && <span className="ml-auto truncate font-mono text-[12px] text-text-3">{active.domain}</span>}
      </div>
      {mobileOpen && <div aria-hidden="true" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-scrim lg:hidden" />}
      <aside
        aria-label="Dashboard"
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-surface-1 transition-[translate] duration-[var(--d-enter)] ease-out lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center px-4">
          <Wordmark href={href("/dashboard")} />
        </div>
        <div className="px-3">
          <SiteSwitcher sites={sites} active={active} onSelect={onSelectSite} />
        </div>
        <nav aria-label="Pentra Answers" className="mt-4 flex-1 overflow-y-auto px-3">
          <ul className="flex flex-col gap-0.5">
            {ANSWERS_NAV.map((item) => {
              const current = isActive(item);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link href={href(item.href)} aria-current={current ? "page" : undefined} onClick={() => setMobileOpen(false)}
                    className={cx("flex h-8 items-center gap-2.5 rounded-control px-2.5 text-[13px] font-medium transition-colors duration-[var(--d-instant)]",
                      current ? "bg-surface-3 text-text" : "text-text-3 hover:bg-surface-2 hover:text-text")}>
                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex flex-col gap-3 border-t border-border p-3">
          {activeSiteId && (
            <QuietBoundary>
              <SidebarPlan siteId={activeSiteId} />
            </QuietBoundary>
          )}
          <div className="flex items-center gap-2.5 px-1.5">{account}</div>
        </div>
      </aside>
    </>
  );
}

/** The plan in one line ("Free snapshot", "Pentra plan", "Pentra's own site"), from the site's overview. */
function SidebarPlan({ siteId }: { siteId: string }) {
  const href = useAppHref();
  const overview = useAnswersQuery("overview", { siteId });
  const access = overview?.access;
  if (!access) return null;
  return (
    <div className="rounded-control px-2.5 py-1">
      <p className="text-[12px] font-medium text-text-2">{PLAN_LABEL[access]}</p>
      {access === "free" && (
        <Link href={href("/dashboard/billing")} className="text-[12px] text-text-3 underline decoration-border-strong underline-offset-2 hover:text-text">
          Publish with Pentra
        </Link>
      )}
    </div>
  );
}

/** A part of the chrome that can't load just isn't shown; the screen beside it says what went wrong. */
class QuietBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function SiteSwitcher({ sites, active, onSelect }: { sites: MySite[]; active: MySite | null; onSelect: (siteId: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const many = sites.length > 1;
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => many && setOpen((v) => !v)} aria-haspopup={many ? "listbox" : undefined} aria-expanded={many ? open : undefined}
        className={cx("flex h-10 w-full items-center gap-2.5 rounded-control border border-border px-2.5 text-left transition-colors duration-[var(--d-instant)]",
          many ? "hover:bg-surface-2" : "cursor-default")}>
        {active ? <SourceGlyph domain={active.domain} /> : <span className="h-4 w-4 rounded-[4px] bg-surface-3" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-text">{active?.name ?? active?.domain ?? "Your site"}</span>
          {active?.name && <span className="block truncate font-mono text-[11px] text-text-3">{active.domain}</span>}
        </span>
        {many && <ChevronsUpDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-3" strokeWidth={1.5} />}
      </button>
      {open && (
        <ul role="listbox" aria-label="Your websites" data-state="open"
          className="motion-drop absolute inset-x-0 top-[calc(100%+4px)] z-10 rounded-card border border-border-strong bg-surface-2 p-1 shadow-overlay">
          {sites.map((site) => (
            <li key={site.siteId} role="option" aria-selected={site.siteId === active?.siteId}>
              <button type="button" onClick={() => { onSelect(site.siteId); setOpen(false); }}
                className="flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left transition-colors duration-[var(--d-instant)] hover:bg-surface-3">
                <SourceGlyph domain={site.domain} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-text">{site.domain}</span>
                  <span className="block text-[11px] text-text-3">{site.answers ? (site.confirmed ? "Pentra Answers" : "Answers · setting up") : "Articles"}</span>
                </span>
                {site.siteId === active?.siteId && <Check aria-hidden="true" className="h-3.5 w-3.5 text-text-2" strokeWidth={1.5} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The frame a dashboard screen sits in (the same geometry as the dashboard layout: 240px sidebar, 1152px content). */
export function AnswersMain({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="min-h-dvh lg:pl-60">
      <div className="mx-auto max-w-6xl px-[var(--gutter)] pb-16 pt-20 sm:px-6 lg:pt-8">{children}</div>
    </main>
  );
}
