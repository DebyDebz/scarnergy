const LABEL_STYLE: Record<string, string> = {
  "A+++": "bg-emerald-700 text-white",
  "A++":  "bg-emerald-600 text-white",
  "A+":   "bg-emerald-500 text-white",
  A:      "bg-green-500 text-white",
  B:      "bg-lime-500 text-white",
  C:      "bg-yellow-400 text-gray-900",
  D:      "bg-amber-400 text-gray-900",
  E:      "bg-orange-500 text-white",
  F:      "bg-red-500 text-white",
  G:      "bg-red-700 text-white",
};

export function EnergyLabelBadge({ label }: { label: string | null }) {
  if (!label) {
    return <span className="text-xs text-gray-300 italic">—</span>;
  }
  const style = LABEL_STYLE[label] ?? "bg-gray-200 text-gray-700";
  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-md text-xs font-bold ${style}`}>
      {label}
    </span>
  );
}
