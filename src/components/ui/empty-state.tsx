import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-[#1E293B] bg-[#111827] px-8 py-14 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1E293B] text-[#475569]">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-[#F1F5F9]">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-[#64748B]">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
