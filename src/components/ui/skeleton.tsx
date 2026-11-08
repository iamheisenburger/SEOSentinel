import { cx } from "@/lib/cx";

/** Skeletons match the final layout; a 1.4s shimmer from surface-2 to surface-3, static under reduced motion. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={cx("skeleton rounded-control", className)} />;
}

export function CardSkeleton() {
  return (
    <div className="rounded-card border border-border bg-surface-1 p-5">
      <Skeleton className="mb-3 h-3 w-24" />
      <Skeleton className="mb-2 h-6 w-40" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-card border border-border bg-surface-1 p-5">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-8 w-16" />
      <Skeleton className="mt-3 h-3 w-28" />
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="flex h-11 items-center gap-4 px-5">
      <Skeleton className="h-3.5 w-48" />
      <Skeleton className="ml-auto h-5 w-16 rounded-full" />
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading">
      <div>
        <Skeleton className="mb-2 h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
      <div className="divide-y divide-border rounded-card border border-border bg-surface-1">
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </div>
    </div>
  );
}
