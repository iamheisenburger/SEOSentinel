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
} from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { useActiveSite } from "@/contexts/site-context";

const navSections = [
  {
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/plan", label: "Topics", icon: Target },
      { href: "/articles", label: "Articles", icon: FileText },
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
  const { isFreePlan } = usePlanLimits();
  const { sites, activeSite, setActiveSiteId } = useActiveSite();
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
    <nav className="flex flex-col gap-7 px-3">
      {navSections.map((section, si) => (
        <div key={si}>
          {section.label && (
            <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#565A6E]">
              {section.label}
            </p>
          )}
          <div className="flex flex-col gap-1">
            {section.items.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`
                    group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-medium transition-all
                    ${
                      active
                        ? "bg-white/[0.06] text-white"
                        : "text-[#8B8FA3] hover:bg-white/[0.03] hover:text-white"
                    }
                  `}
                >
                  <Icon
                    className={`h-[18px] w-[18px] shrink-0 transition-colors ${
                      active ? "text-[#0EA5E9]" : "text-[#565A6E] group-hover:text-[#8B8FA3]"
                    }`}
                  />
                  <span>{item.label}</span>
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-[#0EA5E9]" />
                  )}
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
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.06] bg-[#0F1117] text-[#8B8FA3] transition hover:text-white lg:hidden"
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
          fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-white/[0.04] bg-[#0A0B10]
          transition-transform duration-200 ease-out
          lg:translate-x-0
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-white/[0.04] px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0EA5E9]/[0.1]">
            <Radar className="h-[18px] w-[18px] text-[#0EA5E9]" />
          </div>
          <span className="text-[18px] font-bold tracking-tight">
            Pentra
          </span>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-5">{nav}</div>

        {/* Upgrade CTA (free plan only) */}
        {isFreePlan && (
          <div className="px-3 pb-3">
            <Link
              href="/upgrade"
              className="flex items-center justify-between rounded-xl border border-[#0EA5E9]/25 bg-[#0EA5E9]/[0.06] px-4 py-3.5 transition hover:bg-[#0EA5E9]/[0.12]"
            >
              <div>
                <p className="text-[13px] font-bold text-[#0EA5E9]">Upgrade Plan</p>
                <p className="text-[11px] text-[#8B8FA3] mt-0.5">Unlock more articles & sites</p>
              </div>
              <ArrowUpRight className="h-4 w-4 text-[#0EA5E9]" />
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
                  <p className="truncate text-[13px] font-medium text-[#EDEEF1]">
                    {activeSite.siteName || activeSite.domain}
                  </p>
                  <p className="text-[11px] text-[#565A6E]">
                    {activeSite.autopilotEnabled !== false ? "Autopilot on" : "Manual"}
                  </p>
                </div>
                {hasMultipleSites && (
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[#565A6E] transition-transform ${siteDropdownOpen ? "rotate-180" : ""}`} />
                )}
              </button>

              {/* Dropdown */}
              {siteDropdownOpen && sites && (
                <div className="absolute bottom-full left-0 right-0 mb-1.5 rounded-lg border border-white/[0.08] bg-[#0F1117] py-1.5 shadow-xl shadow-black/40">
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
                        <span className="truncate text-[12px] font-medium text-[#EDEEF1]">
                          {s.siteName || s.domain}
                        </span>
                        {isSelected && (
                          <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-[#0EA5E9]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-[#565A6E]">No site configured</p>
          )}
        </div>

        {/* User profile */}
        <div className="border-t border-white/[0.04] px-4 py-3.5">
          <div className="flex items-center gap-3">
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "h-8 w-8",
                },
              }}
            />
            <span className="text-[13px] font-medium text-[#8B8FA3]">Account</span>
          </div>
        </div>
      </aside>
    </>
  );
}
