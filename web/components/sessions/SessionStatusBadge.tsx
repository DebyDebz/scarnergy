const STATUS_STYLES: Record<string, string> = {
  active:    'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  paused:    'bg-amber-100 text-amber-700',
  cancelled: 'bg-gray-100 text-gray-600',
};

export function SessionStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}
