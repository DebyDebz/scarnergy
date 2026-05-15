export function AnomalyBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
      <span className="text-xl">⚠</span>
      <div>
        <p className="text-sm font-semibold text-orange-800">
          {count} anomal{count === 1 ? "y" : "ies"} detected
        </p>
        <p className="text-xs text-orange-600 mt-0.5">
          Measurements outside the valid range (0–50 000 mm) flagged automatically.
        </p>
      </div>
    </div>
  );
}
