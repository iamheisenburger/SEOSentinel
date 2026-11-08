import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

/** Empty states sit inside the area that will fill: what will appear, why it isn't there yet, one action. */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-card border border-dashed border-border-strong px-6 py-12 text-center">
      {icon && <div className="mx-auto mb-3 flex h-5 w-5 items-center justify-center text-text-3 [&_svg]:h-5 [&_svg]:w-5">{icon}</div>}
      <h3 className="text-[14px] font-semibold text-text">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-sm text-[14px] leading-[22px] text-text-3">{description}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
