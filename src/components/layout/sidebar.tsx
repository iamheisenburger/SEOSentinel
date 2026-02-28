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
    <nav className="flex flex-col gap-0.5 px-3">
      {navItems.map((item) => {
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
            <Icon className={`h-4 w-4 shrink-0 ${active ? "text-[#0EA5E9]" : ""}`} />
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
        <div className="flex h-14 items-center gap-2 border-b border-white/[0.04] px-5">
          <Radar className="h-4 w-4 text-[#0EA5E9]" />
          <span className="text-[14px] font-semibold tracking-tight">
            SEOSentinel
          </span>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-3">{nav}</div>

        {/* Bottom */}
        <div className="border-t border-white/[0.04] px-5 py-3">
          <p className="text-[11px] text-[#565A6E]">v0.2.0</p>
        </div>
      </aside>
    </>
  );
}
