import Link from 'next/link';
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase-server';
import { MeasurementFilters } from '@/components/measurements/MeasurementFilters';
import { MeasurementsLiveTable } from '@/components/measurements/MeasurementsLiveTable';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { RecentMeasurement } from '@/lib/types';

export const revalidate = 30;

const PAGE_SIZE = 50;

interface Props {
  searchParams: {
    q?: string;
    anomalies_only?: string;
    from?: string;
    to?: string;
    page?: string;
  };
}

export default async function MeasurementsPage({ searchParams }: Props) {
  const supabase = await createClient();

  const q = searchParams.q ?? '';
  const anomaliesOnly = searchParams.anomalies_only === '1';
  const from = searchParams.from ?? '';
  const to = searchParams.to ?? '';
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10));
  const offset = (page - 1) * PAGE_SIZE;

  let query = (supabase.from('recent_measurements') as any)
    .select('*', { count: 'exact' })
    .order('measured_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (q) query = query.ilike('building_address', `%${q}%`);
  if (anomaliesOnly) query = query.eq('is_anomaly', true);
  if (from) query = query.gte('measured_at', `${from}T00:00:00`);
  if (to) query = query.lte('measured_at', `${to}T23:59:59`);

  const result = await query as unknown as { data: RecentMeasurement[] | null; count: number | null };
  const measurements = result.data ?? [];
  const total = result.count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function pageHref(p: number) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (anomaliesOnly) params.set('anomalies_only', '1');
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('page', String(p));
    return `/measurements?${params.toString()}`;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Measurement History</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {total.toLocaleString()} measurement{total !== 1 ? 's' : ''}
          {anomaliesOnly ? ' · anomalies only' : ''}
        </p>
      </div>

      <Suspense>
        <MeasurementFilters />
      </Suspense>

      <MeasurementsLiveTable initialMeasurements={measurements} />

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Page {page} of {totalPages} · {total.toLocaleString()} total
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={pageHref(page - 1)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600"
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </Link>
            ) : (
              <span className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed">
                <ChevronLeft className="w-4 h-4" /> Previous
              </span>
            )}
            {page < totalPages ? (
              <Link
                href={pageHref(page + 1)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600"
              >
                Next <ChevronRight className="w-4 h-4" />
              </Link>
            ) : (
              <span className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed">
                Next <ChevronRight className="w-4 h-4" />
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
