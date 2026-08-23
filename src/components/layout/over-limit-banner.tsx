"use client";

import { AlertTriangle, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useActiveSite } from "@/contexts/site-context";

/**
 * Shows the server-authoritative parking state after a downgrade. Entitled
 * sites keep running; only records explicitly parked by the plan sync are
 * blocked from new work.
 */
export function OverLimitBanner() {
  const { sites, activeSite } = useActiveSite();
  const parkedSites = sites?.filter(
    (site) => site.planAccessStatus === "parked",
  ) ?? [];
  if (parkedSites.length === 0) return null;

  const activeIsParked = activeSite?.planAccessStatus === "parked";
  const parkedLabel = parkedSites.length === 1 ? "site" : "sites";

  return (
    <div className="mb-5 flex items-center gap-3 rounded-xl border border-[#EF4444]/20 bg-[#EF4444]/[0.05] px-5 py-3.5">
      <AlertTriangle className="h-4 w-4 shrink-0 text-[#EF4444]" />
      <div className="flex-1">
        <p className="text-[13px] font-medium text-[#F87171]">
          {activeIsParked
            ? `${activeSite.siteName || activeSite.domain} is parked by your current plan.`
            : `${parkedSites.length} ${parkedLabel} parked by your current plan.`}
        </p>
        <p className="text-[12px] text-[#F87171]/70 mt-0.5">
          {activeIsParked && activeSite.planAccessReason
            ? `${activeSite.planAccessReason} `
            : "Their data and integrations remain preserved. "}
          Active entitled sites continue running normally.
        </p>
      </div>
      <Link
        href="/upgrade"
        className="inline-flex items-center gap-1.5 shrink-0 rounded-lg bg-[#EF4444]/[0.1] border border-[#EF4444]/20 px-3.5 py-2 text-[12px] font-medium text-[#F87171] hover:bg-[#EF4444]/[0.15] transition"
      >
        Upgrade
        <ArrowUpRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
