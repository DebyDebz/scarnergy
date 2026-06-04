import { PageHeaderSkeleton, Skeleton, TableSkeleton } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />

      {/* Invite user card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <Skeleton className="h-4 w-32" />
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-10 w-56 rounded-lg" />
          <Skeleton className="h-10 w-56 rounded-lg" />
          <Skeleton className="h-10 w-40 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
        </div>
      </div>

      <TableSkeleton rows={6} cols={5} />
    </div>
  );
}
