import { PageHeaderSkeleton, Skeleton, TableSkeleton } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-20 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-10 w-64 rounded-lg ml-auto" />
      </div>

      {/* Code · Building · Inspector · Started · Measurements · Anomalies · Status · Actions */}
      <TableSkeleton rows={8} cols={8} />
    </div>
  );
}
