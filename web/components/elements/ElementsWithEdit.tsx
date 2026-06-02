'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, TriangleAlert } from 'lucide-react';
import { EnergyLabelBadge } from '@/components/buildings/EnergyLabelBadge';
import { ElementEditPanel } from './ElementEditPanel';
import type { BuildingElement, Opening, Zone } from '@/lib/types';

type ZoneWithElements = Zone & {
  elements: (BuildingElement & { opening: Opening | null })[];
};

interface Props {
  zones: ZoneWithElements[];
}

export function ElementsWithEdit({ zones }: Props) {
  const router = useRouter();
  const [selectedElement, setSelectedElement] = useState<BuildingElement | null>(null);
  const [selectedOpening, setSelectedOpening] = useState<Opening | null>(null);

  const openPanel = useCallback((el: BuildingElement, opening: Opening | null) => {
    setSelectedElement(el);
    setSelectedOpening(opening);
  }, []);

  const closePanel = useCallback(() => {
    setSelectedElement(null);
    setSelectedOpening(null);
  }, []);

  const handleSaved = useCallback(() => {
    router.refresh();
  }, [router]);

  return (
    <>
      <div className="divide-y divide-gray-100">
        {zones.map(zone => {
          return (
            <details key={zone.id} className="group">
              <summary className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-gray-50 list-none">
                <span className="w-4 h-4 text-gray-400 group-open:rotate-90 transition-transform inline-block text-center">›</span>
                <span className="font-medium text-gray-800">{zone.name}</span>
                <span className="text-xs text-gray-400 font-mono">{zone.zone_code}</span>
                <span className="ml-auto text-xs text-gray-500">Level {zone.floor_level}</span>
                <span className="text-xs text-gray-500 ml-4">{zone.elements.length} elements</span>
                {zone.energy_label && (
                  <span className="ml-2">
                    <EnergyLabelBadge label={zone.energy_label} />
                  </span>
                )}
              </summary>

              <div className="px-5 pb-4 pt-1">
                <p className="text-xs text-gray-500 mb-3">
                  Area: <span className="font-medium text-gray-700">{zone.gross_area_m2} m²</span>
                </p>
                {zone.elements.length > 0 ? (
                  <div className="rounded-lg border border-gray-100 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500 bg-gray-50 border-b border-gray-100">
                          <th className="px-4 py-2 font-medium">Name</th>
                          <th className="px-4 py-2 font-medium">Type</th>
                          <th className="px-4 py-2 font-medium">Dimensions</th>
                          <th className="px-4 py-2 font-medium">Rc (m²K/W)</th>
                          <th className="px-4 py-2 font-medium">U (W/m²K)</th>
                          <th className="px-4 py-2 font-medium">Status</th>
                          <th className="px-4 py-2 font-medium w-8" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {zone.elements.map(el => {
                          const dims = [
                            el.length_mm ? `${el.length_mm}mm` : null,
                            el.width_mm  ? `${el.width_mm}mm`  : null,
                            el.height_mm ? `${el.height_mm}mm` : null,
                          ].filter(Boolean).join(' × ');
                          return (
                            <tr key={el.id} className="hover:bg-gray-50">
                              <td className="px-4 py-2 font-medium text-gray-900">{el.name}</td>
                              <td className="px-4 py-2 text-gray-500 capitalize">{el.element_type}</td>
                              <td className="px-4 py-2 text-gray-500 font-mono">{dims || '—'}</td>
                              <td className="px-4 py-2 text-gray-700">{el.rc_value ?? '—'}</td>
                              <td className="px-4 py-2 text-gray-700">{el.u_value ?? '—'}</td>
                              <td className="px-4 py-2">
                                {!el.is_complete ? (
                                  <span className="inline-flex items-center gap-1 text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-medium">
                                    <TriangleAlert className="w-3 h-3" /> incomplete
                                  </span>
                                ) : (
                                  <span className="text-emerald-600 font-medium">✓</span>
                                )}
                              </td>
                              <td className="px-4 py-2">
                                <button
                                  onClick={() => openPanel(el, el.opening)}
                                  className="p-1 rounded hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors"
                                  title="Edit element details"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">No elements defined for this zone</p>
                )}
              </div>
            </details>
          );
        })}
        {zones.length === 0 && (
          <p className="px-5 py-6 text-sm text-gray-400 text-center">No zones defined for this building</p>
        )}
      </div>

      {selectedElement && (
        <ElementEditPanel
          element={selectedElement}
          opening={selectedOpening}
          onClose={closePanel}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
