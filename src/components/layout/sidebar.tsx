"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import {
  LayoutDashboard,
  FileText,
  Target,
  Zap,
  Settings,
  Menu,
  X,
  Globe,
  ArrowUpRight,
  ChevronsUpDown,
  Check,
  BarChart3,
} from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { useActiveSite } from "@/contexts/site-context";
import { api } from "../../../convex/_generated/api";
import { contentServiceStatus } from "../../lib/content-service-status";
import { useVisibleQuery } from "@/hooks/useVisibleQuery";
import { AnswersSidebarConnected } from "@/components/answers/dashboard/selection";
import { Wordmark } from "@/components/marketing/wordmark";
import { SourceGlyph } from "@/components/ui/evidence-card";
import { cx } from "@/lib/cx";

const navSections = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/plan", label: "Topics", icon: Target },
      { href: "/articles", label: "Articles", icon: FileText },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      // Backlink outreach is not part of the current product; /backlinks stays
      // reachable for legacy accounts but is not advertised in navigation.
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/sites", label: "Websites", icon: Globe },
      { href: "/jobs", label: "Activity", icon: Zap },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function LegacySidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isFreePlan, isPlanLoaded } = usePlanLimits();
  const { sites, activeSite, setActiveSiteId } = useActiveSite();
  const contentState = useVisibleQuery(api.contentWork.readiness, activeSite?.serviceMode === "growth_first" ? { siteId: activeSite._id } : "skip");
  const deliveryLabel = activeSite?.serviceMode === "growth_first"
    ? contentServiceStatus(contentState?.siteId === activeSite._id ? contentState : null).label
    : contentServiceStatus({ serviceMode: "legacy_articles", enabled: activeSite?.autopilotEnabled }).label;
  const [siteDropdownOpen, setSiteDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const hasMultipleSites = (sites?.length ?? 0) > 1;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSiteDropdownOpen(false);
      }
    }
    if (siteDropdownOpen) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [siteDropdownOpen]);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const nav = (
    <nav aria-label="Pentra" className="flex flex-col gap-5 px-3">
      {navSections.map((section, si) => (
        <div key={si}>
          {section.label && (
            <p className="mb-1 px-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-text-3">
              {section.label}
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={cx(
                      "flex h-8 items-center gap-2.5 rounded-control px-2.5 text-[13px] font-medium transition-colors duration-[var(--d-instant)]",
                      active ? "bg-surface-3 text-text" : "text-text-3 hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* Phone top bar: the same as the Answers dashboard's */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-[rgba(8,9,10,0.88)] px-4 backdrop-blur-[20px] lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          className="inline-flex h-9 w-9 items-center justify-center rounded-control border border-border text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
        >
          {mobileOpen ? <X className="h-4 w-4" strokeWidth={1.5} /> : <Menu className="h-4 w-4" strokeWidth={1.5} />}
        </button>
        <Wordmark href="/dashboard" />
        {activeSite && <span className="ml-auto truncate font-mono text-[12px] text-text-3">{activeSite.domain}</span>}
      </div>

      {mobileOpen && (
        <div aria-hidden="true" className="fixed inset-0 z-40 bg-scrim lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        aria-label="Dashboard"
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-surface-1 transition-[translate] duration-[var(--d-enter)] ease-out lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center px-4">
          <Wordmark href="/dashboard" />
        </div>

        {/* Site switcher */}
        <div className="px-3" ref={dropdownRef}>
          {activeSite ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => hasMultipleSites && setSiteDropdownOpen(!siteDropdownOpen)}
                aria-haspopup={hasMultipleSites ? "listbox" : undefined}
                aria-expanded={hasMultipleSites ? siteDropdownOpen : undefined}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-control border border-border px-2.5 py-2 text-left transition-colors duration-[var(--d-instant)]",
                  hasMultipleSites ? "hover:bg-surface-2" : "cursor-default",
                )}
              >
                <SourceGlyph domain={activeSite.domain} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-text">{activeSite.siteName || activeSite.domain}</span>
                  <span className="block truncate text-[11px] text-text-3">
                    {activeSite.planAccessStatus === "parked" ? "Parked by plan" : deliveryLabel}
                  </span>
                </span>
                {hasMultipleSites && <ChevronsUpDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-3" strokeWidth={1.5} />}
              </button>

              {siteDropdownOpen && sites && (
                <ul
                  role="listbox"
                  aria-label="Your websites"
                  data-state="open"
                  className="motion-drop absolute inset-x-0 top-[calc(100%+4px)] z-10 rounded-card border border-border-strong bg-surface-2 p-1 shadow-overlay"
                >
                  {sites.map((s) => {
                    const isSelected = s._id === activeSite._id;
                    return (
                      <li key={s._id} role="option" aria-selected={isSelected}>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveSiteId(s._id);
                            setSiteDropdownOpen(false);
                          }}
                          className="flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left transition-colors duration-[var(--d-instant)] hover:bg-surface-3"
                        >
                          <SourceGlyph domain={s.domain} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-text">{s.siteName || s.domain}</span>
                            {s.planAccessStatus === "parked" && <span className="block text-[11px] text-text-3">Parked by plan</span>}
                          </span>
                          {isSelected && <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-2" strokeWidth={1.5} />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <p className="px-2.5 text-[12px] text-text-3">No site configured</p>
          )}
        </div>

        <div className="mt-4 flex-1 overflow-y-auto pb-4">{nav}</div>

        <div className="flex flex-col gap-3 border-t border-border p-3">
          {isPlanLoaded && isFreePlan && (
            <Link
              href="/upgrade"
              className="flex items-center justify-between gap-3 rounded-control border border-border px-2.5 py-2 transition-colors duration-[var(--d-instant)] hover:bg-surface-2"
            >
              <span>
                <span className="block text-[12px] font-medium text-text">Upgrade</span>
                <span className="block text-[12px] text-text-3">See the Pentra plan</span>
              </span>
              <ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.5} />
            </Link>
          )}
          <div className="flex items-center gap-2.5 px-1.5">
            <UserButton userProfileMode="modal" appearance={{ elements: { avatarBox: "h-7 w-7" } }} />
            <span className="text-[13px] font-medium text-text-2">Account</span>
          </div>
        </div>
      </aside>
    </>
  );
}

/**
 * Nov 2026: a site on Pentra Answers gets the Answers sidebar (Overview, Questions, Answer pages, Citations,
 * Competitors, Settings, Billing); an articles site keeps the sidebar above, untouched.
 */
export function Sidebar() {
  const { activeSite, answersSites, answersStatus } = useActiveSite();
  if (answersStatus === "loading") return <SidebarPlaceholder />;
  const entry = answersSites?.find((site) => site.siteId === activeSite?._id);
  return entry?.answers ? <AnswersSidebarConnected /> : <LegacySidebar />;
}

/** While the account's sites load: the frame only, so neither sidebar flashes before the right one. */
function SidebarPlaceholder() {
  return (
    <aside aria-hidden="true" className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-surface-1 lg:flex">
      <div className="mx-4 mt-5 h-5 w-24 rounded-control bg-surface-2" />
      <div className="mx-3 mt-6 h-10 rounded-control bg-surface-2" />
    </aside>
  );
}
