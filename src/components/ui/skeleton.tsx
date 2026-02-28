export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-[#1E293B] ${className}`}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-[#1E293B] bg-[#111827] p-6">
      <Skeleton className="mb-3 h-4 w-24" />
      <Skeleton className="mb-2 h-6 w-40" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-2xl border border-[#1E293B] bg-[#111827] p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div>
          <Skeleton className="mb-2 h-3 w-16" />
          <Skeleton className="h-6 w-12" />
        </div>
      </div>
      <Skeleton className="mt-3 h-3 w-24" />
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-5 py-3.5">
      <Skeleton className="h-8 w-8 rounded-lg" />
      <div className="flex-1">
        <Skeleton className="mb-1.5 h-4 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <Skeleton className="mb-2 h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
      <div className="rounded-2xl border border-[#1E293B] bg-[#111827] divide-y divide-[#1E293B]">
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </div>
    </div>
  );
}
