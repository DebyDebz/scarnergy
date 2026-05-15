interface Props {
  label: string;
  value: number | string;
  sub?: string;
  accent?: "default" | "warning" | "danger" | "success";
}

const ACCENT = {
  default: "text-brand-700",
  warning: "text-warning",
  danger:  "text-danger",
  success: "text-success",
};

export function KpiCard({ label, value, sub, accent = "default" }: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{label}</p>
      <p className={`mt-2 text-4xl font-bold ${ACCENT[accent]}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}
