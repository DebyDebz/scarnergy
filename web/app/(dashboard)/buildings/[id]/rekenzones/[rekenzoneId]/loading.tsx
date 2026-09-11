import { PageHeaderSkeleton, Skeleton, TableSkeleton } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />
      <Skeleton className="h-24 w-full rounded-xl" />
      <TableSkeleton rows={5} cols={4} />
    </div>
  );
}
