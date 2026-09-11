'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, X, Loader2, Trash2 } from 'lucide-react';
import { buildVerdiepingEditRow } from '@/lib/appsheet/mappers';

// AppSheet-mode counterpart to ZoneEditButton — same slide-over UI, minus
// the plafond/warmtecap controls (those are ScanergyV2-only calc fields
// with no AppSheet column, per ELEMENT_CALC_DEFAULTS in lib/appsheet/mappers.ts).
// Verdiepingen's GBO/Hoogte/Notities are a clean 1:1 with the Scanergy zone
// fields this button edits, so the field set otherwise matches exactly.
//
// Delete has no Scanergy-mode equivalent at all (zones aren't deletable
// there either) — added specifically for AppSheet per explicit request.
// Blocks if the zone still has elements (confirmed live: AppSheet's Delete
// API doesn't cascade, so a non-empty zone must be emptied first — same
// "folder must be empty" rule rather than risking orphaned element rows).

interface Props {
  zoneId: string;
  zoneName: string;
  ceilingHeightM: number | null;
  grossAreaM2: number | null;
  description: string | null;
  elementCount: number;
}

const inputCls =
  'text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 max-w-[180px] w-full';

export function AppsheetZoneEditButton({ zoneId, zoneName, ceilingHeightM, grossAreaM2, description, elementCount }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const [error, setError] = useState('');

  const [hoogte, setHoogte] = useState(ceilingHeightM != null ? String(ceilingHeightM) : '');
  const [oppervlakte, setOppervlakte] = useState(grossAreaM2 != null ? String(grossAreaM2) : '');
  const [notities, setNotities] = useState(description ?? '');

  function onSave() {
    startTransition(async () => {
      setError('');
      const row = buildVerdiepingEditRow(zoneId, {
        ceilingHeightM: hoogte === '' ? null : Number(hoogte),
        grossAreaM2: oppervlakte === '' ? null : Number(oppervlakte),
        notes: notities === '' ? null : notities,
      });

      try {
        const res = await fetch('/api/appsheet/Verdiepingen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'edit', rows: [row] }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? 'Verdieping opslaan mislukt');
        }
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Opslaan mislukt');
      }
    });
  }

  function onDelete() {
    startDeleteTransition(async () => {
      setError('');
      try {
        const res = await fetch('/api/appsheet/Verdiepingen', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: [{ 'Verdieping ID': zoneId }] }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? 'Verdieping verwijderen mislukt');
        }
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Verwijderen mislukt');
      }
    });
  }

  return (
    <>
      <button
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
        title="Verdieping bewerken"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
              <div>
                <h2 className="font-semibold text-gray-900">{zoneName}</h2>
                <p className="text-xs text-gray-500 mt-0.5">Verdieping · Storey properties</p>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
              <div className="flex items-center gap-3 px-5 py-3">
                <label className="flex-1 text-sm text-gray-700 font-medium" htmlFor="appsheet-zone-hoogte">Hoogte (m)</label>
                <input id="appsheet-zone-hoogte" type="number" step="0.01" value={hoogte}
                       onChange={e => setHoogte(e.target.value)} className={inputCls} placeholder="2.60" />
              </div>
              <div className="flex items-center gap-3 px-5 py-3">
                <label className="flex-1 text-sm text-gray-700 font-medium" htmlFor="appsheet-zone-go">GBO (m²)</label>
                <input id="appsheet-zone-go" type="number" step="0.01" value={oppervlakte}
                       onChange={e => setOppervlakte(e.target.value)} className={inputCls} placeholder="74.11" />
              </div>
              <div className="px-5 py-3">
                <label className="block text-sm text-gray-700 font-medium mb-1.5" htmlFor="appsheet-zone-notities">Notities</label>
                <textarea id="appsheet-zone-notities" rows={3} value={notities}
                          onChange={e => setNotities(e.target.value)}
                          className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 w-full" />
              </div>
              <p className="px-5 py-3 text-xs text-gray-400">
                Plafond en warmtecapaciteit zijn niet beschikbaar voor AppSheet-verdiepingen.
                <br />
                <span className="italic">Ceiling type and heat capacity aren&apos;t available for AppSheet-sourced floors.</span>
              </p>
            </div>

            <div className="px-5 py-4 border-t border-gray-200 shrink-0 space-y-2">
              {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

              {confirmingDelete ? (
                <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2.5 space-y-2">
                  <p className="text-xs text-red-700">
                    Delete <span className="font-medium">{zoneName}</span> from AppSheet? This cannot be undone.
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => setConfirmingDelete(false)} disabled={isDeleting}
                            className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 bg-white">
                      Cancel
                    </button>
                    <button onClick={onDelete} disabled={isDeleting}
                            className="flex-1 px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                      {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {isDeleting ? 'Deleting…' : 'Yes, delete'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => elementCount === 0 && setConfirmingDelete(true)}
                  disabled={elementCount > 0}
                  title={elementCount > 0 ? `Delete this zone's ${elementCount} element${elementCount === 1 ? '' : 's'} first` : undefined}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {elementCount > 0 ? `Delete this zone's ${elementCount} element${elementCount === 1 ? '' : 's'} first` : 'Delete zone'}
                </button>
              )}

              <div className="flex gap-2">
                <button onClick={() => setOpen(false)}
                        className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={onSave} disabled={isPending}
                        className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
                  {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
