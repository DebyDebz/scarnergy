import { requireProfile } from "@/lib/auth";
import { BuildingFormModal } from "@/components/buildings/BuildingFormModal";
import { EnergyLabelBadge } from "@/components/buildings/EnergyLabelBadge";
import type { BuildingSummary } from "@/lib/types";
import Link from "next/link";

export default async function BuildingsPage() {
  const { supabase } = await requireProfile();

  const { data } = await supabase
    .from("building_summary")
    .select("*")
    .order("created_at", { ascending: false });

  const buildings = (data ?? []) as BuildingSummary[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Buildings</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {buildings.length} building{buildings.length !== 1 ? "s" : ""}
          </p>
        </div>
        <BuildingFormModal
          trigger={
            <button className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold hover:bg-brand-700 transition-colors">
              + Add Building
            </button>
          }
        />
      </div>

      {buildings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-20 text-center">
          <p className="text-gray-400 text-sm">No buildings yet. Add your first one above.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-3 font-medium text-gray-500">Address</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Type</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Built</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Floor area</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Zones</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Label</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {buildings.map(b => (
                <tr key={b.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3">
                    <Link
                      href={`/buildings/${b.id}`}
                      className="font-medium text-brand-500 hover:underline"
                    >
                      {b.street} {b.house_number}
                    </Link>
                    <span className="block text-xs text-gray-400">
                      {b.postal_code} {b.city}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-600 capitalize">
                    {b.building_type.replace(/_/g, " ")}
                  </td>
                  <td className="px-5 py-3 text-gray-600">{b.construction_year ?? "—"}</td>
                  <td className="px-5 py-3 text-gray-600">
                    {b.gross_floor_area_m2 ? `${b.gross_floor_area_m2} m²` : "—"}
                  </td>
                  <td className="px-5 py-3 text-gray-600">{b.zone_count}</td>
                  <td className="px-5 py-3">
                    <EnergyLabelBadge label={b.latest_energy_label} />
                  </td>
                  <td className="px-5 py-3 text-gray-600">{b.session_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
