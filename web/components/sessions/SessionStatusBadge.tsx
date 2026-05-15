const STYLE: Record<string, string> = {
  active:    "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  paused:    "bg-orange-100 text-orange-700",
};

export function SessionStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${STYLE[status] ?? "bg-gray-100 text-gray-500"}`}>
      {status}
    </span>
  );
}
