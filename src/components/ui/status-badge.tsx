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
  | "review";

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
    bg: "bg-[#22C55E]/10",
    text: "text-[#4ADE80]",
  },
  done: {
    label: "Done",
    dot: "bg-[#22C55E]",
    bg: "bg-[#22C55E]/10",
    text: "text-[#4ADE80]",
  },
  ready: {
    label: "Ready",
    dot: "bg-[#22C55E]",
    bg: "bg-[#22C55E]/10",
    text: "text-[#4ADE80]",
  },
  draft: {
    label: "Draft",
    dot: "bg-[#F59E0B]",
    bg: "bg-[#F59E0B]/10",
    text: "text-[#FBBF24]",
  },
  review: {
    label: "Review",
    dot: "bg-[#F59E0B]",
    bg: "bg-[#F59E0B]/10",
    text: "text-[#FBBF24]",
  },
  generating: {
    label: "Generating",
    dot: "bg-[#0EA5E9] animate-pulse-glow",
    bg: "bg-[#0EA5E9]/10",
    text: "text-[#38BDF8]",
  },
  running: {
    label: "Running",
    dot: "bg-[#0EA5E9] animate-pulse-glow",
    bg: "bg-[#0EA5E9]/10",
    text: "text-[#38BDF8]",
  },
  queued: {
    label: "Queued",
    dot: "bg-[#0EA5E9]",
    bg: "bg-[#0EA5E9]/10",
    text: "text-[#38BDF8]",
  },
  failed: {
    label: "Failed",
    dot: "bg-[#EF4444]",
    bg: "bg-[#EF4444]/10",
    text: "text-[#F87171]",
  },
  pending: {
    label: "Pending",
    dot: "bg-[#64748B]",
    bg: "bg-[#64748B]/10",
    text: "text-[#94A3B8]",
  },
  planned: {
    label: "Planned",
    dot: "bg-[#64748B]",
    bg: "bg-[#64748B]/10",
    text: "text-[#94A3B8]",
  },
  used: {
    label: "Used",
    dot: "bg-[#64748B]",
    bg: "bg-[#64748B]/10",
    text: "text-[#64748B]",
  },
};

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const s = config[status as Status] ?? {
    label: status,
    dot: "bg-[#64748B]",
    bg: "bg-[#64748B]/10",
    text: "text-[#94A3B8]",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.bg} ${s.text} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
