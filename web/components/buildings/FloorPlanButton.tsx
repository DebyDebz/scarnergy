'use client';

import { useState } from 'react';
import { Map, Pencil } from 'lucide-react';
import { FloorPlanUploadModal } from './FloorPlanUploadModal';
import type { Zone } from '@/lib/types';

interface Props {
  zone: Zone;
  buildingId: string;
}

export function FloorPlanButton({ zone, buildingId }: Props) {
  const [open, setOpen]         = useState(false);
  const [current, setCurrent]   = useState<Zone>(zone);
  const hasFloorPlan = !!current.floor_plan_image_url;

  return (
    <>
      <button
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-colors ${
          hasFloorPlan
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
        }`}
      >
        {hasFloorPlan ? <Pencil className="w-3 h-3" /> : <Map className="w-3 h-3" />}
        {hasFloorPlan ? 'Edit floor plan' : 'Upload floor plan'}
      </button>

      {open && (
        <FloorPlanUploadModal
          zone={current}
          buildingId={buildingId}
          onClose={() => setOpen(false)}
          onSaved={updated => { setCurrent(updated); setOpen(false); }}
        />
      )}
    </>
  );
}
