import { PageHeaderSkeleton, Skeleton, TableSkeleton } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton withAction />
      <Skeleton className="h-10 w-full max-w-sm rounded-lg" />
      <TableSkeleton rows={8} cols={7} />
    </div>
  );
}
