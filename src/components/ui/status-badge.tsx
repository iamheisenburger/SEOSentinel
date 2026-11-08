"use client";

import { StatusPill, type PillKind } from "@/components/ui/status-pill";

/** Pipeline and article statuses shown in existing screens, mapped onto the status pill. */
const config: Record<string, { label: string; kind: PillKind }> = {
  published: { label: "Published", kind: "published" },
  done: { label: "Done", kind: "published" },
  ready: { label: "Approved", kind: "published" },
  rejected: { label: "Rejected", kind: "failed" },
  failed: { label: "Failed", kind: "failed" },
  draft: { label: "Draft", kind: "draft" },
  review: { label: "Review", kind: "neutral" },
  generating: { label: "Generating", kind: "indexing" },
  running: { label: "Running", kind: "indexing" },
  queued: { label: "Queued", kind: "neutral" },
  pending: { label: "Pending", kind: "neutral" },
  planned: { label: "Planned", kind: "neutral" },
  used: { label: "Used", kind: "draft" },
};

export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const entry = config[status] ?? { label: status, kind: "neutral" as const };
  return (
    <StatusPill kind={entry.kind} className={className}>
      {entry.label}
    </StatusPill>
  );
}
