'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Map } from 'lucide-react';
import { FloorPlanUploadModal } from './FloorPlanUploadModal';
import type { Zone } from '@/lib/types';

interface Props {
  zones: Zone[];
  buildingId: string;
}

/**
 * Section-level "Upload floor plan" button for the building detail page.
 * Floor plans are zone-scoped, so with multiple zones this opens a small
 * picker first; with a single zone it jumps straight into the existing
 * FloorPlanUploadModal. Reuses the same modal used by the per-zone buttons.
 */
export function BuildingFloorPlanUpload({ zones, buildingId }: Props) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeZone, setActiveZone] = useState<Zone | null>(null);

  const handleClick = () => {
    if (zones.length === 1) {
      setActiveZone(zones[0]);
    } else {
      setPickerOpen(o => !o);
    }
  };

  // No zones yet → still show the button, disabled, so it's always findable.
  if (zones.length === 0) {
    return (
      <button
        disabled
        title="Add a zone to this building first, then upload its floor plan"
        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-300 cursor-not-allowed"
      >
        <Map className="w-4 h-4" /> Upload floor plan
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
      >
        <Map className="w-4 h-4" /> Upload floor plan
      </button>

      {pickerOpen && zones.length > 1 && (
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 w-60 bg-white border border-gray-200 rounded-lg shadow-lg py-1 max-h-72 overflow-y-auto">
            <p className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-gray-400">Select a zone</p>
            {zones.map(z => (
              <button
                key={z.id}
                onClick={() => { setActiveZone(z); setPickerOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between gap-2"
              >
                <span className="text-gray-700 truncate">{z.name}</span>
                {z.floor_plan_image_url && (
                  <span className="shrink-0 text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                    has plan
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {activeZone && (
        <FloorPlanUploadModal
          zone={activeZone}
          buildingId={buildingId}
          onClose={() => setActiveZone(null)}
          onSaved={() => { setActiveZone(null); router.refresh(); }}
        />
      )}
    </div>
  );
}
