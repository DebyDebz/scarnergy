import { requireProfile } from "@/lib/auth";
import { SessionStatusBadge } from "@/components/sessions/SessionStatusBadge";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase } = await requireProfile();

  const { data: session } = await supabase
    .from("session_summary")
    .select("*")
    .eq("id", id)
    .single();

  if (!session) notFound();

  const { data: zones } = await supabase
    .from("zones")
    .select("*, building_elements(*)")
    .eq("building_id", session.building_id)
    .order("floor_level", { ascending: true });

  const totalElements  = (zones ?? []).reduce((n: number, z: any) => n + (z.building_elements?.length ?? 0), 0);
  const doneElements   = (zones ?? []).reduce((n: number, z: any) =>
    n + (z.building_elements?.filter((e: any) => e.is_complete).length ?? 0), 0);

  const { data: recentMeasurements } = await supabase
    .from("measurements")
    .select("*, building_elements(name), zones:building_elements(zone_id(name))")
    .eq("session_id", id)
    .eq("is_deleted", false)
    .order("measured_at", { ascending: false })
    .limit(20);

  return (
    <div className="max-w-4xl">
      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-5">
        <Link href="/sessions" className="hover:text-brand-500 transition-colors">Sessions</Link>
        <span>/</span>
        <span className="font-mono text-gray-600">{session.session_code}</span>
      </div>

      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-gray-900 font-mono">{session.session_code}</h1>
            <SessionStatusBadge status={session.status} />
          </div>
          <p className="text-gray-500 text-sm">
            {session.building_address}, {session.building_city}
          </p>
        </div>

        {session.status === "completed" && (
          <a
            href={`/api/sessions/${id}/export`}
            download={`${session.session_code}.xml`}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-semibold hover:bg-brand-700 transition-colors shrink-0"
          >
            ↓ Download XML
          </a>
        )}
      </div>

      {/* ── Info cards ── */}
      <div className="grid grid-cols-2 gap-4 mb-6 sm:grid-cols-4">
        {[
          { label: "Inspector",    value: session.inspector_name },
          { label: "Started",      value: new Date(session.started_at).toLocaleDateString("nl-NL") },
          { label: "Completed",    value: session.completed_at ? new Date(session.completed_at).toLocaleDateString("nl-NL") : "—" },
          { label: "Measurements", value: session.total_measurements ?? 0 },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">{label}</p>
            <p className="text-base font-semibold text-gray-800">{value}</p>
          </div>
        ))}
      </div>

      {/* ── Zone + element progress ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">Elements</h2>
          <span className="text-sm text-gray-500">{doneElements} / {totalElements} complete</span>
        </div>

        {(zones ?? []).map((z: any) => (
          <div key={z.id} className="mb-4 last:mb-0">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {z.zone_code} — {z.name}
            </p>
            <div className="divide-y divide-gray-50 border border-gray-100 rounded-lg overflow-hidden">
              {(z.building_elements ?? []).length === 0 ? (
                <p className="px-4 py-2 text-xs text-gray-400 italic">No elements</p>
              ) : (
                (z.building_elements ?? []).map((e: any) => (
                  <div key={e.id} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                        {e.element_type}
                      </span>
                      <span className="text-sm text-gray-700">{e.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      {e.length_mm != null && <span>L {e.length_mm} mm</span>}
                      {e.height_mm != null && <span>H {e.height_mm} mm</span>}
                      {e.width_mm  != null && <span>W {e.width_mm} mm</span>}
                      {e.is_complete
                        ? <span className="text-green-600 font-semibold">✓</span>
                        : <span className="text-gray-300">—</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Recent measurements ── */}
      {(recentMeasurements ?? []).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Recent measurements</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left pb-2 text-xs font-medium text-gray-400">Element</th>
                <th className="text-left pb-2 text-xs font-medium text-gray-400">Type</th>
                <th className="text-right pb-2 text-xs font-medium text-gray-400">Value</th>
                <th className="text-left pb-2 text-xs font-medium text-gray-400 pl-4">Time</th>
              </tr>
            </thead>
            <tbody>
              {(recentMeasurements ?? []).map((m: any) => (
                <tr key={m.id} className="border-b border-gray-50 last:border-0">
                  <td className="py-2 text-gray-700">{m.building_elements?.name ?? "—"}</td>
                  <td className="py-2 text-gray-500 font-mono text-xs">{m.measurement_type}</td>
                  <td className="py-2 text-right font-semibold text-gray-800">{m.value_mm} mm</td>
                  <td className="py-2 text-gray-400 text-xs pl-4">
                    {new Date(m.measured_at).toLocaleTimeString("nl-NL", {
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
