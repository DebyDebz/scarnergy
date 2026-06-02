'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { useState } from 'react';

export function MeasurementFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const anomaliesOnly = searchParams.get('anomalies_only') === '1';

  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [from, setFrom] = useState(searchParams.get('from') ?? '');
  const [to, setTo] = useState(searchParams.get('to') ?? '');

  function buildParams(overrides: Record<string, string | null>) {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null || v === '') p.delete(k);
      else p.set(k, v);
    }
    p.delete('page');
    return p;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const p = buildParams({ q, from, to });
    router.push(`/measurements?${p.toString()}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search building…"
          className="pl-9 pr-4 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-56"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
        <input
          type="date"
          value={from}
          onChange={e => setFrom(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">To</label>
        <input
          type="date"
          value={to}
          onChange={e => setTo(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <button
        type="submit"
        className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
      >
        Filter
      </button>

      <button
        type="button"
        onClick={() => {
          const p = buildParams({ q, from, to, anomalies_only: anomaliesOnly ? null : '1' });
          router.push(`/measurements?${p.toString()}`);
        }}
        className={`text-sm font-medium px-4 py-2 rounded-lg border transition-colors ${
          anomaliesOnly
            ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600'
            : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
        }`}
      >
        {anomaliesOnly ? '⚠ Anomalies only' : 'All measurements'}
      </button>

      {(q || from || to || anomaliesOnly) && (
        <button
          type="button"
          onClick={() => {
            setQ('');
            setFrom('');
            setTo('');
            router.push('/measurements');
          }}
          className="text-sm text-gray-500 hover:text-gray-800 underline"
        >
          Clear filters
        </button>
      )}
    </form>
  );
}
