import { PageHeaderSkeleton, Skeleton, TableSkeleton } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />

      {/* Filters row */}
      <div className="flex flex-wrap gap-3 items-center">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="h-10 w-36 rounded-lg" />
        <Skeleton className="h-10 w-36 rounded-lg" />
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>

      <TableSkeleton rows={10} cols={7} />

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
