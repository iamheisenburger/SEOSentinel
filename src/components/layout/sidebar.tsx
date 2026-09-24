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
  Radar,
  Globe,
  ArrowUpRight,
  ChevronDown,
  Check,
  BarChart3,
} from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { useActiveSite } from "@/contexts/site-context";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { contentServiceStatus } from "../../lib/content-service-status";

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

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isFreePlan, isPlanLoaded } = usePlanLimits();
  const { sites, activeSite, setActiveSiteId } = useActiveSite();
  const contentState = useQuery(api.contentWork.readiness, activeSite?.serviceMode === "growth_first" ? { siteId: activeSite._id } : "skip");
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

  const brandColor = activeSite?.brandPrimaryColor || "#0EA5E9";

  const nav = (
    <nav className="flex flex-col gap-6 px-3">
      {navSections.map((section, si) => (
        <div key={si}>
          {section.label && (
            <p className="mb-1.5 px-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-[#62666D]">
              {section.label}
            </p>
          )}
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`
                    group relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px] font-medium transition-colors
                    ${
                      active
                        ? "bg-white/[0.07] text-[#F7F8F8]"
                        : "text-[#8A8F98] hover:bg-white/[0.04] hover:text-[#F7F8F8]"
                    }
                  `}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 transition-colors ${
                      active ? "text-[#F7F8F8]" : "text-[#62666D] group-hover:text-[#8A8F98]"
                    }`}
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.06] bg-[#0E0F11] text-[#8A8F98] transition hover:text-white lg:hidden"
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-white/[0.06] bg-[#0B0C0E]
          transition-transform duration-200 ease-out
          lg:translate-x-0
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Logo */}
        <Link href="/dashboard" className="flex h-14 items-center gap-2.5 border-b border-white/[0.05] px-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0EA5E9]/15">
            <Radar className="h-4 w-4 text-[#0EA5E9]" />
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-[#F7F8F8]">
            Pentra
          </span>
        </Link>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-4">{nav}</div>

        {/* Upgrade CTA (free plan only) */}
        {isPlanLoaded && isFreePlan && (
          <div className="px-3 pb-3">
            <Link
              href="/upgrade"
              className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.03] px-3.5 py-3 transition hover:bg-white/[0.06]"
            >
              <div>
                <p className="text-[13px] font-semibold text-[#F7F8F8]">Upgrade plan</p>
                <p className="mt-0.5 text-[11px] text-[#8A8F98]">More articles and sites</p>
              </div>
              <ArrowUpRight className="h-4 w-4 text-[#8A8F98]" />
            </Link>
          </div>
        )}

        {/* Site switcher */}
        <div className="border-t border-white/[0.04] px-4 py-3.5" ref={dropdownRef}>
          {activeSite ? (
            <div className="relative">
              <button
                onClick={() => hasMultipleSites && setSiteDropdownOpen(!siteDropdownOpen)}
                className={`flex w-full items-center gap-2.5 rounded-lg bg-white/[0.02] px-3 py-2.5 text-left transition ${hasMultipleSites ? "hover:bg-white/[0.05] cursor-pointer" : ""}`}
              >
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: brandColor + "18" }}
                >
                  <Globe className="h-3.5 w-3.5" style={{ color: brandColor }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[#F7F8F8]">
                    {activeSite.siteName || activeSite.domain}
                  </p>
                  <p className="text-[11px] text-[#62666D]">
                    {activeSite.planAccessStatus === "parked"
                      ? "Parked by plan"
                      : deliveryLabel}
                  </p>
                </div>
                {hasMultipleSites && (
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[#62666D] transition-transform ${siteDropdownOpen ? "rotate-180" : ""}`} />
                )}
              </button>

              {/* Dropdown */}
              {siteDropdownOpen && sites && (
                <div className="absolute bottom-full left-0 right-0 mb-1.5 rounded-lg border border-white/[0.08] bg-[#0E0F11] py-1.5 shadow-xl shadow-black/40">
                  {sites.map((s) => {
                    const isSelected = s._id === activeSite._id;
                    const sColor = s.brandPrimaryColor || "#0EA5E9";
                    return (
                      <button
                        key={s._id}
                        onClick={() => {
                          setActiveSiteId(s._id);
                          setSiteDropdownOpen(false);
                        }}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-white/[0.04] ${isSelected ? "bg-white/[0.03]" : ""}`}
                      >
                        <div
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                          style={{ backgroundColor: sColor + "18" }}
                        >
                          <Globe className="h-3 w-3" style={{ color: sColor }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium text-[#F7F8F8]">
                            {s.siteName || s.domain}
                          </span>
                          {s.planAccessStatus === "parked" && (
                            <span className="block text-[10px] text-[#F87171]">
                              Parked by plan
                            </span>
                          )}
                        </div>
                        {isSelected && (
                          <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-[#F7F8F8]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-[#62666D]">No site configured</p>
          )}
        </div>

        {/* User profile */}
        <div className="border-t border-white/[0.04] px-4 py-3.5">
          <div className="flex items-center gap-3">
            <UserButton
              userProfileMode="modal"
              appearance={{
                elements: {
                  avatarBox: "h-8 w-8",
                },
              }}
            />
            <span className="text-[13px] font-medium text-[#8A8F98]">Account</span>
          </div>
        </div>
      </aside>
    </>
  );
}
