import { PageHeaderSkeleton, TableSkeleton } from '@/components/ui/Skeleton';

// Generic fallback for any dashboard route without its own loading.tsx.
export default function Loading() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />
      <TableSkeleton rows={8} cols={6} />
    </div>
  );
}
