import { requireProfile } from "@/lib/auth";
import { SessionStatusBadge } from "@/components/sessions/SessionStatusBadge";
import Link from "next/link";

export default async function SessionsPage() {
  const { supabase } = await requireProfile();

  const { data } = await supabase
    .from("session_summary")
    .select("*")
    .order("started_at", { ascending: false });

  const sessions = data ?? [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Inspection Sessions</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </p>
      </div>

      {sessions.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-20 text-center">
          <p className="text-gray-400 text-sm">No sessions yet. Start one from the mobile app.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-3 font-medium text-gray-500">Code</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Building</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Inspector</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Started</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Export</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s: any) => (
                <tr key={s.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3">
                    <Link
                      href={`/sessions/${s.id}`}
                      className="font-mono font-semibold text-brand-500 hover:underline"
                    >
                      {s.session_code}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-700">
                    {s.building_address}, {s.building_city}
                  </td>
                  <td className="px-5 py-3 text-gray-600">{s.inspector_name}</td>
                  <td className="px-5 py-3 text-gray-500">
                    {new Date(s.started_at).toLocaleDateString("nl-NL", {
                      day: "2-digit", month: "short", year: "numeric",
                    })}
                  </td>
                  <td className="px-5 py-3">
                    <SessionStatusBadge status={s.status} />
                  </td>
                  <td className="px-5 py-3">
                    {s.status === "completed" && (
                      <a
                        href={`/api/sessions/${s.id}/export`}
                        download={`${s.session_code}.xml`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                      >
                        ↓ XML
                      </a>
                    )}
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
