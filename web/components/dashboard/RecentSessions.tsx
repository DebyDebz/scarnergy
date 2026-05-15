import Link from "next/link";
import type { SessionSummary } from "@/lib/types";

const STATUS_COLOR: Record<string, string> = {
  active:    "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  paused:    "bg-orange-100 text-orange-700",
};

export function RecentSessions({ sessions }: { sessions: SessionSummary[] }) {
  if (sessions.length === 0) {
    return <p className="text-sm text-gray-400 italic py-4">No sessions yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-2 pr-4 font-semibold text-gray-500">Code</th>
            <th className="text-left py-2 pr-4 font-semibold text-gray-500">Building</th>
            <th className="text-left py-2 pr-4 font-semibold text-gray-500">Inspector</th>
            <th className="text-left py-2 pr-4 font-semibold text-gray-500">Started</th>
            <th className="text-right py-2 pr-4 font-semibold text-gray-500">Measurements</th>
            <th className="text-left py-2 font-semibold text-gray-500">Status</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map(s => (
            <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
              <td className="py-2.5 pr-4">
                <Link href={`/sessions/${s.id}`} className="font-mono text-xs text-brand-500 hover:underline">
                  {s.session_code}
                </Link>
              </td>
              <td className="py-2.5 pr-4 text-gray-700">
                {s.building_address}, {s.building_city}
              </td>
              <td className="py-2.5 pr-4 text-gray-600">{s.inspector_name}</td>
              <td className="py-2.5 pr-4 text-gray-500">
                {new Date(s.started_at).toLocaleDateString("nl-NL")}
              </td>
              <td className="py-2.5 pr-4 text-right font-medium text-gray-700">
                {s.total_measurements.toLocaleString()}
                {s.anomaly_count > 0 && (
                  <span className="ml-2 text-xs text-orange-500">⚠ {s.anomaly_count}</span>
                )}
              </td>
              <td className="py-2.5">
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLOR[s.status] ?? "bg-gray-100 text-gray-500"}`}>
                  {s.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
