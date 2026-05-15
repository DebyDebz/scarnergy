import { requireProfile } from "@/lib/auth";
import { BuildingFormModal } from "@/components/buildings/BuildingFormModal";
import { AddZoneButton } from "@/components/buildings/AddZoneButton";
import { AddElementButton } from "@/components/buildings/AddElementButton";
import { ZoneEnergyLabelSelect } from "@/components/buildings/ZoneEnergyLabelSelect";
import type { Building, Zone, BuildingElement } from "@/lib/types";
import { notFound } from "next/navigation";
import Link from "next/link";

type ZoneWithElements = Zone & { building_elements: BuildingElement[] };

export default async function BuildingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase } = await requireProfile();

  const { data: building, error } = await supabase
    .from("buildings")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !building) notFound();

  const { data: zones } = await supabase
    .from("zones")
    .select("*, building_elements(*)")
    .eq("building_id", id)
    .eq("is_active", true)
    .order("floor_level")
    .order("zone_code");

  const b = building as Building;
  const zoneList = (zones ?? []) as ZoneWithElements[];
  const totalElements = zoneList.reduce((sum, z) => sum + z.building_elements.length, 0);

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-4">
        <Link href="/buildings" className="hover:text-brand-500 transition-colors">Buildings</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{b.street} {b.house_number}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {b.street} {b.house_number}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {b.postal_code} {b.city}
            {b.building_type && ` · ${b.building_type.replace(/_/g, " ")}`}
            {b.construction_year && ` · Built ${b.construction_year}`}
          </p>
          {b.reference_code && (
            <span className="inline-block mt-1 text-xs text-gray-400 font-mono bg-gray-100 px-2 py-0.5 rounded">
              {b.reference_code}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <BuildingFormModal
            building={b}
            trigger={
              <button className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                Edit
              </button>
            }
          />
          <AddZoneButton buildingId={id} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
          <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold">Zones</p>
          <p className="text-3xl font-bold text-brand-700 mt-1">{zoneList.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
          <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold">Elements</p>
          <p className="text-3xl font-bold text-brand-700 mt-1">{totalElements}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
          <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold">Floor area</p>
          <p className="text-3xl font-bold text-brand-700 mt-1">
            {b.gross_floor_area_m2 ? `${b.gross_floor_area_m2}` : "—"}
            {b.gross_floor_area_m2 && <span className="text-base font-normal text-gray-400 ml-1">m²</span>}
          </p>
        </div>
      </div>

      {/* Zones */}
      {zoneList.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-20 text-center">
          <p className="text-gray-400 text-sm">No zones yet. Add the first zone above.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {zoneList.map(zone => (
            <div key={zone.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* Zone header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <ZoneEnergyLabelSelect zoneId={zone.id} current={zone.energy_label} />
                  <div>
                    <span className="font-semibold text-gray-900">{zone.name}</span>
                    <span className="text-xs text-gray-400 ml-2">
                      {zone.zone_code} · Floor {zone.floor_level}
                    </span>
                    {zone.gross_area_m2 && (
                      <span className="text-xs text-gray-400 ml-2">{zone.gross_area_m2} m²</span>
                    )}
                  </div>
                </div>
                <AddElementButton zoneId={zone.id} />
              </div>

              {/* Elements table */}
              {zone.building_elements.length === 0 ? (
                <p className="px-5 py-4 text-sm text-gray-300 italic">No elements yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-5 py-2 text-xs font-medium text-gray-400">Element</th>
                      <th className="text-left px-5 py-2 text-xs font-medium text-gray-400">Type</th>
                      <th className="text-left px-5 py-2 text-xs font-medium text-gray-400">Rc (m²K/W)</th>
                      <th className="text-left px-5 py-2 text-xs font-medium text-gray-400">U (W/m²K)</th>
                      <th className="text-left px-5 py-2 text-xs font-medium text-gray-400">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zone.building_elements.map(el => (
                      <tr key={el.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-2.5 font-medium text-gray-800">{el.name}</td>
                        <td className="px-5 py-2.5 text-gray-500 capitalize">
                          {el.element_type}
                        </td>
                        <td className="px-5 py-2.5 text-gray-500">{el.rc_value ?? "—"}</td>
                        <td className="px-5 py-2.5 text-gray-500">{el.u_value ?? "—"}</td>
                        <td className="px-5 py-2.5">
                          {el.is_complete ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                              Complete
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">Pending</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
