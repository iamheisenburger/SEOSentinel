"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
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
} from "lucide-react";

const navSections = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/sites", label: "Websites", icon: Globe },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/articles", label: "Articles", icon: FileText },
      { href: "/plan", label: "Topics", icon: Target },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/jobs", label: "Pipeline", icon: Zap },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const sites = useQuery(api.sites.list);
  const site = sites?.[0];

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const nav = (
    <nav className="flex flex-col gap-6 px-3">
      {navSections.map((section, si) => (
        <div key={si}>
          {section.label && (
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#565A6E]">
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
                    group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all
                    ${
                      active
                        ? "bg-white/[0.06] text-white"
                        : "text-[#8B8FA3] hover:bg-white/[0.03] hover:text-white"
                    }
                  `}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 transition-colors ${
                      active ? "text-[#0EA5E9]" : "text-[#565A6E] group-hover:text-[#8B8FA3]"
                    }`}
                  />
                  <span>{item.label}</span>
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-r-full bg-[#0EA5E9]" />
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
        className="fixed left-4 top-4 z-50 flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.06] bg-[#0F1117] text-[#8B8FA3] transition hover:text-white lg:hidden"
      >
        {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
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
          fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r border-white/[0.04] bg-[#0A0B10]
          transition-transform duration-200 ease-out
          lg:translate-x-0
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Logo */}
        <div className="flex h-14 items-center gap-2.5 border-b border-white/[0.04] px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0EA5E9]/[0.1]">
            <Radar className="h-3.5 w-3.5 text-[#0EA5E9]" />
          </div>
          <span className="text-[14px] font-semibold tracking-tight">
            SEOSentinel
          </span>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-4">{nav}</div>

        {/* Site indicator */}
        <div className="border-t border-white/[0.04] px-4 py-3">
          {site ? (
            <div className="flex items-center gap-2.5 rounded-lg bg-white/[0.02] px-3 py-2">
              <Globe className="h-3.5 w-3.5 text-[#0EA5E9]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-[#EDEEF1]">
                  {site.domain}
                </p>
                <p className="text-[10px] text-[#565A6E]">
                  {site.autopilotEnabled !== false ? "Autopilot on" : "Manual"}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-[#565A6E]">No site configured</p>
          )}
        </div>
      </aside>
    </>
  );
}
