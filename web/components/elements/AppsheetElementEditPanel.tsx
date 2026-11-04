'use client';

import { useEffect, useState, useTransition } from 'react';
import { X, Loader2, Trash2 } from 'lucide-react';
import { mmToM } from '@scarnergy/opname-calc';
import {
  buildGevelEditRow, buildDakEditRow, buildVloerEditRow, buildInstallatieEditRow,
  GRENST_AAN_OMSCHRIJVING, ORIENTATIE_LABELS,
} from '@/lib/appsheet/mappers';
import type { ElementWithRelations } from './ElementTypeSections';

// AppSheet-mode counterpart to ElementEditPanel — same slide-over shape and
// field-driven layout, but the field set per element type is only what the
// corresponding AppSheet sheet (Gevels/Daken/Vloeren/Installaties) actually
// has a column for (no rc_value/u_value/insulation_type-style ScanergyV2
// calc fields — those have no AppSheet equivalent, see ELEMENT_CALC_DEFAULTS
// in lib/appsheet/mappers.ts). "Sla op als standaard" isn't offered — that's
// a ScanergyV2 org-settings feature with nothing to plug into here.
//
// Delete has no Scanergy-mode equivalent (elements aren't deletable there
// either) — added specifically for AppSheet per explicit request. Any
// Transparante Delen (openings) attached to the element ARE cascade-deleted
// first (see handleDelete) — Transparante_Delen got a real write path
// (Add/Edit/Delete, confirmed live) once this was closed.

type FieldType = 'select' | 'number' | 'text';
interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
}

const TABLE_AND_KEY_BY_TYPE: Record<string, { table: string; key: string }> = {
  gevel: { table: 'Gevels', key: 'Gevel ID' },
  dak: { table: 'Daken', key: 'Dak ID' },
  vloer: { table: 'Vloeren', key: 'Vloer ID' },
  installatie: { table: 'Installaties', key: 'Installatie ID' },
};

const GRENST_AAN_OPTIONS = Object.values(GRENST_AAN_OMSCHRIJVING);
const ORIENTATIE_OPTIONS = Object.values(ORIENTATIE_LABELS);
const ORIENTATIE_LABEL_TO_DEG: Record<string, number> = Object.fromEntries(
  Object.entries(ORIENTATIE_LABELS).map(([deg, label]) => [label, Number(deg)])
);

const FIELDS_BY_TYPE: Record<string, FieldDef[]> = {
  gevel: [
    { key: 'name', label: 'Naam', type: 'text' },
    { key: 'positie', label: 'Positie', type: 'select', options: ['Voorgevel', 'Achtergevel', 'Linkergevel', 'Rechtergevel'] },
    { key: 'widthM', label: 'Breedte (m)', type: 'number' },
    { key: 'heightM', label: 'Hoogte (m)', type: 'number' },
    { key: 'areaM2', label: 'Bruto Oppervlakte (m²)', type: 'number' },
    { key: 'orientation', label: 'Orientatie', type: 'select', options: ORIENTATIE_OPTIONS },
    { key: 'grenztAan', label: 'Grenzend aan', type: 'select', options: GRENST_AAN_OPTIONS },
    { key: 'notes', label: 'Notities', type: 'text' },
  ],
  dak: [
    { key: 'name', label: 'Naam', type: 'text' },
    { key: 'lengthM', label: 'Lengte Dak (m)', type: 'number' },
    { key: 'widthM', label: 'Breedte Dak (m)', type: 'number' },
    { key: 'areaM2', label: 'Bruto Oppervlakte (m²)', type: 'number' },
    { key: 'tiltDeg', label: 'Hoek (°)', type: 'number' },
    { key: 'roofType', label: 'Type Dak', type: 'select', options: ['Plat Dak', 'Hellend Dak'] },
    { key: 'nokhoogteM', label: 'Nokhoogte (m)', type: 'number' },
    { key: 'grenztAan', label: 'Grenzend aan', type: 'select', options: GRENST_AAN_OPTIONS },
    { key: 'notes', label: 'Notities', type: 'text' },
  ],
  vloer: [
    { key: 'name', label: 'Naam', type: 'text' },
    { key: 'lengthM', label: 'Lengte (m)', type: 'number' },
    { key: 'widthM', label: 'Breedte (m)', type: 'number' },
    { key: 'areaM2', label: 'Bruto Oppervlakte (m²)', type: 'number' },
    { key: 'vloerisolatie', label: 'Vloerisolatie', type: 'text' },
    { key: 'grenztAan', label: 'Grenzend aan', type: 'select', options: GRENST_AAN_OPTIONS },
    { key: 'notes', label: 'Notities', type: 'text' },
  ],
  installatie: [
    { key: 'installationType', label: 'Type Installatie', type: 'text' },
    // Confirmed live: this AppSheet column is a constrained Enum accepting
    // only these two values — free text 400s.
    { key: 'locatie', label: 'Locatie in huis', type: 'select', options: ['Binnen de thermische zone', 'Buiten de thermische zone'] },
    { key: 'merkModel', label: 'Merk/Model', type: 'text' },
    { key: 'notes', label: 'Notities', type: 'text' },
  ],
};

// Populates form state from the already-mapped BuildingElement (mm -> m for
// display, degrees -> Dutch label, omschrijving already carried in
// description).
function initialValues(element: ElementWithRelations): Record<string, string> {
  const orientationLabel = element.orientation_deg != null ? (ORIENTATIE_LABELS[element.orientation_deg] ?? '') : '';
  switch (element.element_type) {
    case 'gevel':
      return {
        name: element.name ?? '',
        positie: element.construction_type ?? '',
        widthM: mmToM(element.length_mm) != null ? String(mmToM(element.length_mm)) : '',
        heightM: mmToM(element.height_mm) != null ? String(mmToM(element.height_mm)) : '',
        areaM2: element.area_m2 != null ? String(element.area_m2) : '',
        orientation: orientationLabel,
        grenztAan: element.description ?? '',
        notes: element.notes ?? '',
      };
    case 'dak':
      return {
        name: element.name ?? '',
        lengthM: mmToM(element.length_mm) != null ? String(mmToM(element.length_mm)) : '',
        widthM: mmToM(element.width_mm) != null ? String(mmToM(element.width_mm)) : '',
        areaM2: element.area_m2 != null ? String(element.area_m2) : '',
        tiltDeg: element.tilt_deg != null ? String(element.tilt_deg) : '',
        roofType: element.construction_type ?? '',
        nokhoogteM: element.nokhoogte_m != null ? String(element.nokhoogte_m) : '',
        grenztAan: element.description ?? '',
        notes: element.notes ?? '',
      };
    case 'vloer':
      return {
        name: element.name ?? '',
        lengthM: mmToM(element.length_mm) != null ? String(mmToM(element.length_mm)) : '',
        widthM: mmToM(element.width_mm) != null ? String(mmToM(element.width_mm)) : '',
        areaM2: element.area_m2 != null ? String(element.area_m2) : '',
        vloerisolatie: element.insulation_type ?? '',
        grenztAan: element.description ?? '',
        notes: element.notes ?? '',
      };
    case 'installatie':
      return {
        installationType: element.installation_type ?? '',
        locatie: element.description ?? '',
        merkModel: element.brand ?? '',
        notes: element.notes ?? '',
      };
    default:
      return {};
  }
}

function buildRow(element: ElementWithRelations, values: Record<string, string>): { table: string; row: Record<string, unknown> } | null {
  const num = (v: string) => (v === '' ? null : Number(v));
  switch (element.element_type) {
    case 'gevel':
      return {
        table: 'Gevels',
        row: buildGevelEditRow(element.id, {
          name: values.name || null,
          positie: values.positie || null,
          widthM: num(values.widthM),
          heightM: num(values.heightM),
          areaM2: num(values.areaM2),
          orientationDeg: values.orientation ? ORIENTATIE_LABEL_TO_DEG[values.orientation] ?? null : null,
          grenztAanOmschrijving: values.grenztAan || null,
          notes: values.notes || null,
        }),
      };
    case 'dak':
      return {
        table: 'Daken',
        row: buildDakEditRow(element.id, {
          name: values.name || null,
          lengthM: num(values.lengthM),
          widthM: num(values.widthM),
          areaM2: num(values.areaM2),
          tiltDeg: num(values.tiltDeg),
          roofType: values.roofType || null,
          nokhoogteM: num(values.nokhoogteM),
          grenztAanOmschrijving: values.grenztAan || null,
          notes: values.notes || null,
        }),
      };
    case 'vloer':
      return {
        table: 'Vloeren',
        row: buildVloerEditRow(element.id, {
          name: values.name || null,
          lengthM: num(values.lengthM),
          widthM: num(values.widthM),
          areaM2: num(values.areaM2),
          vloerisolatie: values.vloerisolatie || null,
          grenztAanOmschrijving: values.grenztAan || null,
          notes: values.notes || null,
        }),
      };
    case 'installatie':
      return {
        table: 'Installaties',
        row: buildInstallatieEditRow(element.id, {
          installationType: values.installationType || null,
          locatie: values.locatie || null,
          merkModel: values.merkModel || null,
          notes: values.notes || null,
        }),
      };
    default:
      return null;
  }
}

interface Props {
  element: ElementWithRelations | null;
  // Accepted for interface parity with ElementEditPanel (see
  // ElementTypeSections' EditPanel prop) — AppSheet elements have no
  // transparant_deel edit surface here, so this is always ignored.
  opening?: unknown;
  onClose: () => void;
  onSaved: () => void;
}

export function AppsheetElementEditPanel({ element, onClose, onSaved }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!element) return;
    setValues(initialValues(element));
    setError(null);
    setConfirmingDelete(false);
  }, [element]);

  const set = (key: string, val: string) => setValues(prev => ({ ...prev, [key]: val }));

  function handleSave() {
    if (!element) return;
    const built = buildRow(element, values);
    if (!built) return;

    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/appsheet/${built.table}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'edit', rows: [built.row] }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? 'Save failed');
          return;
        }
        onSaved();
        onClose();
      } catch {
        setError('Save failed — check your connection');
      }
    });
  }

  function handleDelete() {
    if (!element) return;
    const spec = TABLE_AND_KEY_BY_TYPE[element.element_type];
    if (!spec) return;

    startDeleteTransition(async () => {
      setError(null);
      try {
        // Cascade: delete this element's openings first — otherwise they're
        // left orphaned in AppSheet (never rendered without a parent, but
        // never cleaned up either). Abort before touching the parent row if
        // this fails, rather than leaving a partially-cleaned-up state.
        if (element.openings.length > 0) {
          const openingsRes = await fetch('/api/appsheet/Transparante_Delen', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows: element.openings.map(o => ({ 'Deel ID': o.id })) }),
          });
          if (!openingsRes.ok) {
            const data = await openingsRes.json().catch(() => ({}));
            setError(data.error ?? 'Could not delete this element’s openings');
            return;
          }
        }

        const res = await fetch(`/api/appsheet/${spec.table}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: [{ [spec.key]: element.id }] }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? 'Delete failed');
          return;
        }
        onSaved();
        onClose();
      } catch {
        setError('Delete failed — check your connection');
      }
    });
  }

  if (!element) return null;
  const fields = FIELDS_BY_TYPE[element.element_type] ?? [];

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} aria-hidden />

      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900">{element.name}</h2>
            <p className="text-xs text-gray-500 capitalize mt-0.5">{element.element_type}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {fields.length === 0 ? (
            <p className="px-5 py-8 text-sm text-gray-400 text-center italic">
              No editable fields for this element type.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {fields.map(field => (
                <div key={field.key} className="flex items-center gap-3 px-5 py-3">
                  <label className="flex-1 text-sm text-gray-700 font-medium" htmlFor={field.key}>
                    {field.label}
                  </label>
                  {field.type === 'select' && field.options ? (
                    <select
                      id={field.key}
                      value={values[field.key] ?? ''}
                      onChange={e => set(field.key, e.target.value)}
                      className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 max-w-[180px]"
                    >
                      <option value="">— selecteer —</option>
                      {field.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      id={field.key}
                      type={field.type === 'number' ? 'number' : 'text'}
                      step={field.type === 'number' ? '0.01' : undefined}
                      value={values[field.key] ?? ''}
                      onChange={e => set(field.key, e.target.value)}
                      className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 max-w-[180px] w-full"
                      placeholder={field.type === 'number' ? '0.00' : '…'}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-200 shrink-0 space-y-2">
          {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          {confirmingDelete ? (
            <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2.5 space-y-2">
              <p className="text-xs text-red-700">
                Delete <span className="font-medium">{element.name}</span> from AppSheet? This cannot be undone.
              </p>
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
              Delete element
            </button>
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
