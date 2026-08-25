"use client";

import { useQuery } from "convex/react";
import {
  AlertCircle,
  Check,
  CircleDashed,
  Clock3,
  Loader2,
} from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const STATUS_COPY = {
  ready: {
    title: "Setup receipts verified",
    detail:
      "Every setup dependency below has a canonical receipt. Production publishing and outreach still obey their separate rollout and consent gates.",
    color: "#22C55E",
  },
  in_progress: {
    title: "Pentra is preparing your setup",
    detail:
      "Managed work stays queued until the corresponding connection is independently verified.",
    color: "#0EA5E9",
  },
  action_required: {
    title: "Setup needs your input",
    detail:
      "One or more self-managed connections or pipeline steps still need an owner action.",
    color: "#F59E0B",
  },
  blocked: {
    title: "Setup is blocked",
    detail:
      "A plan, ownership, or provisioning fence must be resolved before setup can continue.",
    color: "#EF4444",
  },
} as const;

const STAGE_COPY = {
  ready: { label: "Verified", icon: Check, className: "text-[#4ADE80]" },
  queued: { label: "Queued", icon: Clock3, className: "text-[#38BDF8]" },
  in_progress: { label: "In progress", icon: Loader2, className: "text-[#38BDF8]" },
  action_required: {
    label: "Action needed",
    icon: CircleDashed,
    className: "text-[#FBBF24]",
  },
  blocked: { label: "Blocked", icon: AlertCircle, className: "text-[#F87171]" },
} as const;

export function SetupReadiness({
  siteId,
  activeOperation,
  compact = false,
}: {
  siteId: Id<"sites">;
  activeOperation?: string | null;
  compact?: boolean;
}) {
  const readiness = useQuery(api.sites.getOneSetupReadiness, { siteId });

  if (readiness === undefined) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
        <div className="h-4 w-48 animate-pulse rounded bg-white/[0.05]" />
        <div className="mt-4 h-2 animate-pulse rounded-full bg-white/[0.04]" />
      </div>
    );
  }

  const summary = STATUS_COPY[readiness.aggregate.status];

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: summary.color }}
            />
            <h2 className="text-[14px] font-semibold text-[#EDEEF1]">
              {summary.title}
            </h2>
          </div>
          {!compact && (
            <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-[#565A6E]">
              {summary.detail}
            </p>
          )}
        </div>
        <span className="shrink-0 text-[12px] font-semibold text-[#8B8FA3]">
          {readiness.aggregate.readyCount}/{readiness.aggregate.totalCount}
        </span>
      </div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${readiness.aggregate.percent}%`,
            backgroundColor: summary.color,
          }}
        />
      </div>

      {activeOperation && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#0EA5E9]/[0.06] px-3 py-2 text-[11px] text-[#38BDF8]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {activeOperation}
        </div>
      )}

      <div className={`mt-4 grid gap-2 ${compact ? "sm:grid-cols-2" : ""}`}>
        {readiness.stages.map((stage) => {
          const stageCopy = STAGE_COPY[stage.state];
          const Icon = stageCopy.icon;
          return (
            <div
              key={stage.key}
              className="flex items-center gap-2 rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2.5"
            >
              <Icon
                className={`h-3.5 w-3.5 shrink-0 ${stageCopy.className} ${
                  stage.state === "in_progress" ? "animate-spin" : ""
                }`}
              />
              <span className="flex-1 text-[11px] text-[#8B8FA3]">
                {stage.label}
              </span>
              <span className={`text-[10px] font-medium ${stageCopy.className}`}>
                {stageCopy.label}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-[#565A6E]">
        This panel reports setup readiness only. It does not claim an article was
        published, an email was delivered, a backlink was acquired, or a ranking
        improved.
      </p>
    </div>
  );
}
