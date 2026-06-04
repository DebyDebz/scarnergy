import { Skeleton, TableSkeleton } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="space-y-6 max-w-5xl">
      {/* Back link + header */}
      <div>
        <Skeleton className="h-4 w-24 mb-3" />
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Skeleton className="h-9 w-28 rounded-lg" />
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </div>

      {/* Measurement chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <Skeleton className="h-5 w-40 mb-4" />
        <Skeleton className="h-56 w-full rounded-lg" />
      </div>

      {/* Measurements feed */}
      <TableSkeleton rows={8} cols={5} />
    </div>
  );
}
