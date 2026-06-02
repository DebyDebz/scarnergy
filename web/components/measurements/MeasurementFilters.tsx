'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';

export function MeasurementFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const q = searchParams.get('q') ?? '';
  const anomaliesOnly = searchParams.get('anomalies_only') === '1';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';

  function buildHref(overrides: Record<string, string | null>) {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null || v === '') p.delete(k);
      else p.set(k, v);
    }
    p.delete('page');
    return `/measurements?${p.toString()}`;
  }

  return (
    <form className="flex flex-wrap gap-3 items-end">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          name="q"
          defaultValue={q}
          placeholder="Search building…"
          className="pl-9 pr-4 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-56"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
        <input
          type="date"
          name="from"
          defaultValue={from}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">To</label>
        <input
          type="date"
          name="to"
          defaultValue={to}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <button
        type="submit"
        className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
      >
        Filter
      </button>

      <a
        href={buildHref({ anomalies_only: anomaliesOnly ? null : '1' })}
        className={`text-sm font-medium px-4 py-2 rounded-lg border transition-colors ${
          anomaliesOnly
            ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600'
            : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
        }`}
      >
        {anomaliesOnly ? '⚠ Anomalies only' : 'All measurements'}
      </a>

      {(q || from || to || anomaliesOnly) && (
        <a href="/measurements" className="text-sm text-gray-500 hover:text-gray-800 underline">
          Clear filters
        </a>
      )}
    </form>
  );
}
