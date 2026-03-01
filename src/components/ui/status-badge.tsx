"use client";

type Status =
  | "published"
  | "draft"
  | "generating"
  | "failed"
  | "pending"
  | "running"
  | "done"
  | "planned"
  | "queued"
  | "used"
  | "ready"
  | "review"
  | "rejected";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

const config: Record<
  Status,
  { label: string; dot: string; bg: string; text: string }
> = {
  published: {
    label: "Published",
    dot: "bg-[#22C55E]",
    bg: "bg-[#22C55E]/[0.08]",
    text: "text-[#4ADE80]",
  },
  done: {
    label: "Done",
    dot: "bg-[#22C55E]",
    bg: "bg-[#22C55E]/[0.08]",
    text: "text-[#4ADE80]",
  },
  ready: {
    label: "Approved",
    dot: "bg-[#22C55E]",
    bg: "bg-[#22C55E]/[0.08]",
    text: "text-[#4ADE80]",
  },
  rejected: {
    label: "Rejected",
    dot: "bg-[#EF4444]",
    bg: "bg-[#EF4444]/[0.08]",
    text: "text-[#F87171]",
  },
  draft: {
    label: "Draft",
    dot: "bg-[#F59E0B]",
    bg: "bg-[#F59E0B]/[0.08]",
    text: "text-[#FBBF24]",
  },
  review: {
    label: "Review",
    dot: "bg-[#F59E0B]",
    bg: "bg-[#F59E0B]/[0.08]",
    text: "text-[#FBBF24]",
  },
  generating: {
    label: "Generating",
    dot: "bg-[#0EA5E9] animate-pulse-glow",
    bg: "bg-[#0EA5E9]/[0.08]",
    text: "text-[#38BDF8]",
  },
  running: {
    label: "Running",
    dot: "bg-[#0EA5E9] animate-pulse-glow",
    bg: "bg-[#0EA5E9]/[0.08]",
    text: "text-[#38BDF8]",
  },
  queued: {
    label: "Queued",
    dot: "bg-[#0EA5E9]",
    bg: "bg-[#0EA5E9]/[0.08]",
    text: "text-[#38BDF8]",
  },
  failed: {
    label: "Failed",
    dot: "bg-[#EF4444]",
    bg: "bg-[#EF4444]/[0.08]",
    text: "text-[#F87171]",
  },
  pending: {
    label: "Pending",
    dot: "bg-[#565A6E]",
    bg: "bg-white/[0.04]",
    text: "text-[#8B8FA3]",
  },
  planned: {
    label: "Planned",
    dot: "bg-[#565A6E]",
    bg: "bg-white/[0.04]",
    text: "text-[#8B8FA3]",
  },
  used: {
    label: "Used",
    dot: "bg-[#565A6E]",
    bg: "bg-white/[0.03]",
    text: "text-[#565A6E]",
  },
};

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const s = config[status as Status] ?? {
    label: status,
    dot: "bg-[#565A6E]",
    bg: "bg-white/[0.04]",
    text: "text-[#8B8FA3]",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.bg} ${s.text} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
