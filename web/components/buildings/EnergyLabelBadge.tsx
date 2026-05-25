const LABEL_STYLES: Record<string, string> = {
  'A++': 'bg-green-600 text-white',
  'A+':  'bg-green-500 text-white',
  A:     'bg-green-400 text-white',
  B:     'bg-lime-400 text-gray-900',
  C:     'bg-yellow-400 text-gray-900',
  D:     'bg-amber-400 text-gray-900',
  E:     'bg-orange-400 text-white',
  F:     'bg-red-400 text-white',
  G:     'bg-red-600 text-white',
};

export function EnergyLabelBadge({ label }: { label: string | null }) {
  if (!label) return <span className="text-xs text-gray-400">—</span>;
  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold ${LABEL_STYLES[label] ?? 'bg-gray-200 text-gray-700'}`}>
      {label}
    </span>
  );
}
