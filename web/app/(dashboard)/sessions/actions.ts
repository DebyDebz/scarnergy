'use server';

import { createServiceClient } from '@/lib/supabase-server';

/**
 * Close (complete) an inspection session.
 *
 * Primary path: the canonical `close_inspection_session` RPC.
 * Fallback path: if that RPC errors (e.g. the historical bug where
 * SUM(is_anomaly) over zero measurements yields NULL and violates the
 * anomaly_count NOT NULL constraint), we close the session manually here
 * with null-safe counts. This mirrors exactly what the RPC computes.
 *
 * Runs with the service-role client so it works regardless of RLS, and
 * needs no database password — only the web app's own service key.
 * Once the RPC itself is fixed in the DB, the fallback simply stops firing.
 */
export async function closeSession(sessionId: string): Promise<{ error?: string }> {
  const supabase = await createServiceClient();

  // 1. Try the canonical RPC first.
  const { error: rpcErr } = await (supabase.rpc as any)('close_inspection_session', {
    p_session_id: sessionId,
  });
  if (!rpcErr) return {};

  // 2. Fallback — replicate the RPC with a null guard on the anomaly sum.
  const { data: session, error: sErr } = await (supabase
    .from('inspection_sessions') as any)
    .select('id, building_id, started_at, status')
    .eq('id', sessionId)
    .single();

  if (sErr || !session) return { error: sErr?.message ?? 'Session not found' };
  if (session.status !== 'active') return { error: 'Session is not active' };

  // total_measurements + anomaly_count (NOT deleted)
  const baseFilter = (q: any) =>
    q.eq('session_id', sessionId).eq('is_deleted', false);

  const { count: total } = await baseFilter(
    (supabase.from('measurements') as any).select('*', { count: 'exact', head: true }),
  );
  const { count: anomalies } = await baseFilter(
    (supabase.from('measurements') as any).select('*', { count: 'exact', head: true }),
  ).eq('is_anomaly', true);

  // completion_pct = distinct measured elements / total active elements in building
  const { data: zoneRows } = await (supabase.from('zones') as any)
    .select('id')
    .eq('building_id', session.building_id);
  const zoneIds: string[] = (zoneRows ?? []).map((z: any) => z.id);

  let totalElements = 0;
  let measuredElements = 0;
  if (zoneIds.length > 0) {
    const { data: elemRows } = await (supabase.from('building_elements') as any)
      .select('id')
      .in('zone_id', zoneIds)
      .eq('is_active', true);
    const elementIds: string[] = (elemRows ?? []).map((e: any) => e.id);
    totalElements = elementIds.length;

    if (elementIds.length > 0) {
      const { data: measuredRows } = await (supabase.from('measurements') as any)
        .select('element_id')
        .eq('session_id', sessionId)
        .in('element_id', elementIds);
      measuredElements = new Set(
        (measuredRows ?? []).map((m: any) => m.element_id).filter(Boolean),
      ).size;
    }
  }

  const completionPct = totalElements > 0
    ? Math.round((measuredElements / totalElements) * 100 * 100) / 100
    : 0;
  const durationSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000),
  );
  const now = new Date().toISOString();

  const { error: uErr } = await (supabase.from('inspection_sessions') as any)
    .update({
      status: 'completed',
      completed_at: now,
      duration_seconds: durationSeconds,
      total_measurements: total ?? 0,
      anomaly_count: anomalies ?? 0,
      completion_pct: completionPct,
      updated_at: now,
    })
    .eq('id', sessionId);

  if (uErr) return { error: uErr.message };
  return {};
}
