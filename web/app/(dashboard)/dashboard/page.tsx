import { requireProfile } from "@/lib/auth";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { RecentSessions } from "@/components/dashboard/RecentSessions";
import type { SessionSummary } from "@/lib/types";
import Link from "next/link";

export default async function DashboardPage() {
  const { supabase } = await requireProfile();

  const [
    { count: buildingCount },
    { count: activeSessionCount },
    { count: anomalyCount },
    { data: recentSessions },
  ] = await Promise.all([
    supabase.from("buildings").select("*", { count: "exact", head: true }),
    supabase.from("inspection_sessions").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("measurements").select("*", { count: "exact", head: true }).eq("is_anomaly", true),
    supabase
      .from("session_summary")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(10),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <Link
          href="/buildings"
          className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold hover:bg-brand-700 transition-colors"
        >
          View Buildings
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <KpiCard label="Buildings" value={buildingCount ?? 0} sub="registered objects" />
        <KpiCard label="Active Sessions" value={activeSessionCount ?? 0} accent="warning" sub="currently open" />
        <KpiCard label="Anomalies" value={anomalyCount ?? 0} accent={anomalyCount ? "danger" : "default"} sub="total flagged measurements" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 px-6 py-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Recent Sessions</h2>
        <RecentSessions sessions={(recentSessions ?? []) as SessionSummary[]} />
      </div>
    </div>
  );
}
