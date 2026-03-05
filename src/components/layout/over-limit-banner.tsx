"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import Link from "next/link";

/**
 * Shows a persistent banner when the user has more sites than their
 * current plan allows (e.g. after a downgrade). Blocks new content
 * generation until they upgrade or remove excess sites.
 */
export function OverLimitBanner() {
  const sites = useQuery(api.sites.list);
  const { maxSites } = usePlanLimits();

  const siteCount = sites?.length ?? 0;
  const overLimit = siteCount > maxSites;

  if (!overLimit) return null;

  return (
    <div className="mb-5 flex items-center gap-3 rounded-xl border border-[#EF4444]/20 bg-[#EF4444]/[0.05] px-5 py-3.5">
      <AlertTriangle className="h-4 w-4 shrink-0 text-[#EF4444]" />
      <div className="flex-1">
        <p className="text-[13px] font-medium text-[#F87171]">
          You have {siteCount} sites but your plan only allows {maxSites}.
        </p>
        <p className="text-[12px] text-[#F87171]/70 mt-0.5">
          Remove {siteCount - maxSites} site{siteCount - maxSites > 1 ? "s" : ""} or upgrade your plan to continue generating articles.
        </p>
      </div>
      <Link
        href="/pricing"
        className="inline-flex items-center gap-1.5 shrink-0 rounded-lg bg-[#EF4444]/[0.1] border border-[#EF4444]/20 px-3.5 py-2 text-[12px] font-medium text-[#F87171] hover:bg-[#EF4444]/[0.15] transition"
      >
        Upgrade
        <ArrowUpRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
