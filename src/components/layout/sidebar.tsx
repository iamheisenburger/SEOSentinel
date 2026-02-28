"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Globe,
  Map,
  FileText,
  Activity,
  Menu,
  X,
  Radar,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/sites", label: "Sites", icon: Globe },
  { href: "/plan", label: "Plan", icon: Map },
  { href: "/articles", label: "Articles", icon: FileText },
  { href: "/jobs", label: "Jobs", icon: Activity },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const nav = (
    <nav className="flex flex-col gap-1 px-3">
      {navItems.map((item) => {
        const active = isActive(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={`
              group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150
              ${
                active
                  ? "bg-[#0EA5E9]/10 text-[#38BDF8]"
                  : "text-[#94A3B8] hover:bg-[#1E293B]/50 hover:text-[#F1F5F9]"
              }
            `}
          >
            {/* Active indicator bar */}
            {active && (
              <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[#0EA5E9]" />
            )}
            <Icon className="h-[18px] w-[18px] shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg border border-[#1E293B] bg-[#111827] text-[#94A3B8] transition hover:text-[#F1F5F9] lg:hidden"
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
          fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-[#1E293B] bg-[#111827]/80 backdrop-blur-xl
          transition-transform duration-200 ease-out
          lg:translate-x-0
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-2.5 border-b border-[#1E293B] px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0EA5E9]/15">
            <Radar className="h-4.5 w-4.5 text-[#0EA5E9]" />
          </div>
          <span className="text-base font-bold tracking-tight text-[#F1F5F9]">
            SEOSentinel
          </span>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-4">{nav}</div>

        {/* Bottom */}
        <div className="border-t border-[#1E293B] px-5 py-4">
          <p className="text-xs text-[#475569]">v0.2.0</p>
        </div>
      </aside>
    </>
  );
}
