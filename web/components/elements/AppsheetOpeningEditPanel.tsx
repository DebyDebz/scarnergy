'use client';

import { useEffect, useState, useTransition } from 'react';
import { X, Loader2, Trash2 } from 'lucide-react';
import { mmToM } from '@scarnergy/opname-calc';
import { buildTransparantDeelEditRow, buildNewTransparantDeelRow } from '@/lib/appsheet/mappers';
import type { Opening } from '@/lib/types';
import type { ElementWithRelations } from './ElementTypeSections';

// AppSheet-mode add/edit panel for a single Transparante_Delen (opening) row
// — the counterpart to AppsheetElementEditPanel, slotted in via
// ElementTypeSections' OpeningEditPanel prop so native mode (which has no
// opening-level write path of its own here) renders nothing new at all.
//
// Confirmed live (see mappers.ts buildTransparantDeelEditRow/
// buildNewTransparantDeelRow comments): "Type Deel"/"Materiaal"/"Glastype"
// are constrained Enums — these option lists are the exact observed live
// vocabulary, not a guess. "Bruto Oppervlakte"/"Netto Oppervlakte" are
// formula columns (Breedte × Hoogte) and aren't editable here.

const TYPE_DEEL_OPTIONS = ['Raam', 'Paneel', 'Deur met Glas', 'Deurglas', 'Deur'];
const MATERIAAL_OPTIONS = ['Kunststof', 'Hout', 'Hout/Kunststof', 'Metaal (Thermisch onderbroken)'];
const GLASTYPE_OPTIONS = ['Dubbel Glas', 'HR Glas (Dubbel Glas met coating)', 'HR++ Glas', 'HR+ Glas', 'Enkel Glas'];

const PARENT_ID_FIELD_BY_TYPE: Record<string, 'Gevel ID' | 'Dak ID' | 'Vloer ID'> = {
  gevel: 'Gevel ID',
  dak: 'Dak ID',
  vloer: 'Vloer ID',
};

interface Props {
  element: ElementWithRelations;
  opening: Opening | null;
  onClose: () => void;
  onSaved: () => void;
}

interface FormValues {
  typeDeel: string;
  materiaal: string;
  glastype: string;
  widthM: string;
  heightM: string;
  notes: string;
}

function initialValues(opening: Opening | null): FormValues {
  if (!opening) {
    return { typeDeel: '', materiaal: '', glastype: '', widthM: '', heightM: '', notes: '' };
  }
  return {
    typeDeel: opening.opening_type ? opening.opening_type.charAt(0).toUpperCase() + opening.opening_type.slice(1) : '',
    materiaal: opening.frame_type ?? '',
    glastype: opening.glazing_type ?? '',
    widthM: mmToM(opening.width_mm) != null ? String(mmToM(opening.width_mm)) : '',
    heightM: mmToM(opening.height_mm) != null ? String(mmToM(opening.height_mm)) : '',
    notes: opening.notes ?? '',
  };
}

export function AppsheetOpeningEditPanel({ element, opening, onClose, onSaved }: Props) {
  const [values, setValues] = useState<FormValues>(initialValues(opening));
  const [isPending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValues(initialValues(opening));
    setError(null);
    setConfirmingDelete(false);
  }, [opening]);

  const set = (key: keyof FormValues, val: string) => setValues(prev => ({ ...prev, [key]: val }));
  const num = (v: string) => (v === '' ? null : Number(v));

  function handleSave() {
    if (!opening && !values.typeDeel) {
      setError('Kies een Type Deel');
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const row = opening
          ? buildTransparantDeelEditRow(opening.id, {
              typeDeel: values.typeDeel || null,
              widthM: num(values.widthM),
              heightM: num(values.heightM),
              glastype: values.glastype || null,
              materiaal: values.materiaal || null,
              notes: values.notes || null,
            })
          : buildNewTransparantDeelRow(PARENT_ID_FIELD_BY_TYPE[element.element_type], element.id, {
              typeDeel: values.typeDeel,
              widthM: num(values.widthM),
              heightM: num(values.heightM),
              glastype: values.glastype || null,
              materiaal: values.materiaal || null,
              notes: values.notes || null,
            });

        const res = await fetch('/api/appsheet/Transparante_Delen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: opening ? 'edit' : 'add', rows: [row] }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? 'Save failed');
          return;
        }
        onSaved();
      } catch {
        setError('Save failed — check your connection');
      }
    });
  }

  function handleDelete() {
    if (!opening) return;
    startDeleteTransition(async () => {
      setError(null);
      try {
        const res = await fetch('/api/appsheet/Transparante_Delen', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: [{ 'Deel ID': opening.id }] }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? 'Delete failed');
          return;
        }
        onSaved();
      } catch {
        setError('Delete failed — check your connection');
      }
    });
  }

  const title = opening ? (opening.name || opening.opening_type) : `Nieuw deel — ${element.name}`;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} aria-hidden />

      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900 capitalize">{title}</h2>
            <p className="text-xs text-gray-500 mt-0.5">Transparant deel</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
          <div className="flex items-center gap-3 px-5 py-3">
            <label className="flex-1 text-sm text-gray-700 font-medium">Type Deel</label>
            <select
              value={values.typeDeel}
              onChange={e => set('typeDeel', e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 max-w-[180px]"
            >
              <option value="">— selecteer —</option>
              {TYPE_DEEL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3 px-5 py-3">
            <label className="flex-1 text-sm text-gray-700 font-medium">Breedte (m)</label>
            <input
              type="number" step="0.01" value={values.widthM} onChange={e => set('widthM', e.target.value)}
              placeholder="0.00"
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 max-w-[180px] w-full"
            />
          </div>
          <div className="flex items-center gap-3 px-5 py-3">
            <label className="flex-1 text-sm text-gray-700 font-medium">Hoogte (m)</label>
            <input
              type="number" step="0.01" value={values.heightM} onChange={e => set('heightM', e.target.value)}
              placeholder="0.00"
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 max-w-[180px] w-full"
            />
          </div>
          <div className="flex items-center gap-3 px-5 py-3">
            <label className="flex-1 text-sm text-gray-700 font-medium">Materiaal</label>
            <select
              value={values.materiaal}
              onChange={e => set('materiaal', e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 max-w-[180px]"
            >
              <option value="">— selecteer —</option>
              {MATERIAAL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3 px-5 py-3">
            <label className="flex-1 text-sm text-gray-700 font-medium">Glastype</label>
            <select
              value={values.glastype}
              onChange={e => set('glastype', e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 max-w-[180px]"
            >
              <option value="">— geen —</option>
              {GLASTYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3 px-5 py-3">
            <label className="flex-1 text-sm text-gray-700 font-medium">Notities</label>
            <input
              type="text" value={values.notes} onChange={e => set('notes', e.target.value)}
              placeholder="…"
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 max-w-[180px] w-full"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-200 shrink-0 space-y-2">
          {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          {opening && (
            confirmingDelete ? (
              <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2.5 space-y-2">
                <p className="text-xs text-red-700">Delete this opening from AppSheet? This cannot be undone.</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmingDelete(false)} disabled={isDeleting}
                          className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 bg-white">
                    Cancel
                  </button>
                  <button onClick={handleDelete} disabled={isDeleting}
                          className="flex-1 px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                    {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {isDeleting ? 'Deleting…' : 'Yes, delete'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingDelete(true)}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete opening
              </button>
            )
          )}

          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isPending}
              className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
