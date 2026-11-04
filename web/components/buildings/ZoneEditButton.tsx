'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, X, Loader2 } from 'lucide-react';
import { warmtecapKJm2K } from '@scarnergy/opname-calc';

// Verdieping/zone edit (GAP W2), mirroring the AppSheet "BG" form:
// Hoogte / GebruiksOppervlakte / Notities live on the zone row; Plafond and
// the warmtecapaciteit classes live on the storey's vloer element (migration
// 024 puts them on building_elements); kJ_m2K is derived read-only and stays
// "—" until the licensed §1.3 forfait table is transcribed (calc Phase 2).

interface VloerCarrier {
  id: string;
  plafond_type: string | null;
  warmtecap_vloer_klasse: string | null;
  warmtecap_gevel_klasse: string | null;
}

interface Props {
  zoneId: string;
  zoneName: string;
  ceilingHeightM: number | null;
  grossAreaM2: number | null;
  description: string | null;
  vloer: VloerCarrier | null;
}

const PLAFOND_OPTIONS = ['gesloten', 'open', 'overig'];
const KLASSE_OPTIONS = ['licht', 'zwaar'];

const inputCls =
  'text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 max-w-[180px] w-full';

export function ZoneEditButton({ zoneId, zoneName, ceilingHeightM, grossAreaM2, description, vloer }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const [hoogte, setHoogte] = useState(ceilingHeightM != null ? String(ceilingHeightM) : '');
  const [oppervlakte, setOppervlakte] = useState(grossAreaM2 != null ? String(grossAreaM2) : '');
  const [notities, setNotities] = useState(description ?? '');
  const [plafond, setPlafond] = useState(vloer?.plafond_type ?? '');
  const [capVloer, setCapVloer] = useState(vloer?.warmtecap_vloer_klasse ?? '');
  const [capGevel, setCapGevel] = useState(vloer?.warmtecap_gevel_klasse ?? '');

  const kjM2K = warmtecapKJm2K(capVloer || null, capGevel || null, plafond || null);

  async function handleSave() {
    setError('');
    const zonePayload: Record<string, unknown> = {
      ceiling_height_m: hoogte === '' ? null : Number(hoogte),
      gross_area_m2: oppervlakte === '' ? null : Number(oppervlakte),
      description: notities === '' ? null : notities,
    };

    const zoneRes = await fetch(`/api/zones/${zoneId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(zonePayload),
    });
    if (!zoneRes.ok) {
      const data = await zoneRes.json().catch(() => ({}));
      throw new Error(data.error ?? 'Zone opslaan mislukt');
    }

    if (vloer) {
      const elRes = await fetch(`/api/elements/${vloer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plafond_type: plafond === '' ? null : plafond,
          warmtecap_vloer_klasse: capVloer === '' ? null : capVloer,
          warmtecap_gevel_klasse: capGevel === '' ? null : capGevel,
        }),
      });
      if (!elRes.ok) {
        const data = await elRes.json().catch(() => ({}));
        throw new Error(data.error ?? 'Warmtecapaciteit opslaan mislukt');
      }
    }
  }

  function onSave() {
    startTransition(async () => {
      try {
        await handleSave();
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Opslaan mislukt');
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
                <label className="flex-1 text-sm text-gray-700 font-medium" htmlFor="zone-hoogte">Hoogte (m)</label>
                <input id="zone-hoogte" type="number" step="0.01" value={hoogte}
                       onChange={e => setHoogte(e.target.value)} className={inputCls} placeholder="2.60" />
              </div>
              <div className="flex items-center gap-3 px-5 py-3">
                <label className="flex-1 text-sm text-gray-700 font-medium" htmlFor="zone-go">GebruiksOppervlakte (m²)</label>
                <input id="zone-go" type="number" step="0.01" value={oppervlakte}
                       onChange={e => setOppervlakte(e.target.value)} className={inputCls} placeholder="74.11" />
              </div>
              <div className="flex items-center gap-3 px-5 py-3">
                <label className="flex-1 text-sm text-gray-700 font-medium" htmlFor="zone-plafond">Plafond</label>
                <select id="zone-plafond" value={plafond} onChange={e => setPlafond(e.target.value)}
                        className={inputCls} disabled={!vloer}>
                  <option value="">— selecteer —</option>
                  {PLAFOND_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3 px-5 py-3">
                <label className="flex-1 text-sm text-gray-700 font-medium" htmlFor="zone-cap-vloer">Warmtecapaciteit vloer</label>
                <select id="zone-cap-vloer" value={capVloer} onChange={e => setCapVloer(e.target.value)}
                        className={inputCls} disabled={!vloer}>
                  <option value="">— selecteer —</option>
                  {KLASSE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3 px-5 py-3">
                <label className="flex-1 text-sm text-gray-700 font-medium" htmlFor="zone-cap-gevel">Warmtecapaciteit gevel</label>
                <select id="zone-cap-gevel" value={capGevel} onChange={e => setCapGevel(e.target.value)}
                        className={inputCls} disabled={!vloer}>
                  <option value="">— selecteer —</option>
                  {KLASSE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3 px-5 py-3">
                <span className="flex-1 text-sm text-gray-700 font-medium">kJ_m2K</span>
                <span className="text-sm text-gray-500" title="Afgeleid uit de warmtecapaciteitsklassen; waarde volgt zodra de forfaittabel (§1.3) is overgenomen">
                  {kjM2K ?? '—'}
                </span>
              </div>
              <div className="px-5 py-3">
                <label className="block text-sm text-gray-700 font-medium mb-1.5" htmlFor="zone-notities">Notities</label>
                <textarea id="zone-notities" rows={3} value={notities}
                          onChange={e => setNotities(e.target.value)}
                          className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 w-full" />
              </div>
              {!vloer && (
                <p className="px-5 py-3 text-xs text-gray-400">
                  Plafond en warmtecapaciteit horen bij het vloer-element van deze verdieping — voeg eerst een vloer toe.
                </p>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-200 shrink-0 space-y-2">
              {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
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
