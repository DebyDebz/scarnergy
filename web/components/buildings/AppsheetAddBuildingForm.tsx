'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import type { Organisation } from '@/lib/types';
import { buildNewObjectenRow, buildNewBagDataRow } from '@/lib/appsheet/mappers';

interface Props {
  orgs: Organisation[];
}

// Same shape AppSheet's own address parsing expects on the read side (see
// mappers.ts's parseAdres city regex) — 4 digits + 2 letters, optional
// space. Catches a malformed postcode (e.g. "0244", missing the letter
// suffix) before it's sent to AppSheet's Add, which otherwise accepts it
// silently and only surfaces the problem after the fact via its own
// address-resolution automation (see the "niet gevonden" warning below).
const NL_POSTCODE_RE = /^\d{4}\s?[A-Za-z]{2}$/;

// AppSheet-side counterpart to AddBuildingForm. Deliberately a different
// field set, not a relabeled copy — Objecten has no reference_code,
// building_type enum, or gross_floor_area_m2 columns (see
// lib/appsheet/mappers.ts buildNewObjectenRow for what's confirmed live). A
// real, resolvable Dutch address is required: AppSheet runs a live
// automation on Add that validates postcode+house number and overwrites
// Adres with an error message if it can't resolve them — the success
// banner below surfaces that instead of a client-side geocoder.
//
// Construction year is optional and, unlike every other field here, isn't
// part of the Objecten row at all — Objecten has no year column (confirmed
// live), only BAG Data does via "BAG Bouwjaar" joined on Object ID. So
// entering a year fires a second Add, into BAG Data, once the Objecten Add
// has returned the new Object ID (see handleSubmit below). Read-side
// (mapObjectenRow) already surfaces BAG Data's Bouwjaar as
// construction_year, so no other read-path change is needed.
export function AppsheetAddBuildingForm({ orgs }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [addressWarning, setAddressWarning] = useState('');
  const [yearWarning, setYearWarning] = useState('');

  const [form, setForm] = useState({
    objecttype: 'Woning' as 'Woning' | 'Utiliteit',
    bedrijfsId: orgs[0]?.id ?? '',
    street: '',
    houseNumber: '',
    houseLetter: '',
    houseAddition: '',
    postalCode: '',
    city: '',
    constructionYear: '',
  });

  function set<K extends keyof typeof form>(field: K, value: typeof form[K]) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setAddressWarning('');
    setYearWarning('');

    if (!NL_POSTCODE_RE.test(form.postalCode.trim())) {
      setError('Postal code must be 4 digits + 2 letters, e.g. "1234 AB"');
      return;
    }

    setLoading(true);

    const row = buildNewObjectenRow({
      objecttype: form.objecttype,
      street: form.street,
      houseNumber: form.houseNumber,
      houseLetter: form.houseLetter || undefined,
      houseAddition: form.houseAddition || undefined,
      postalCode: form.postalCode,
      city: form.city,
      bedrijfsId: form.bedrijfsId,
    });

    const res = await fetch('/api/appsheet/Objecten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', rows: [row] }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? 'Failed to create building');
      setLoading(false);
      return;
    }

    const createdRow = data?.Rows?.[0];
    const objectId = createdRow?.['Object ID'];
    const adres: string = createdRow?.['Adres'] ?? '';

    if (!objectId) {
      setError('AppSheet did not return a new Object ID');
      setLoading(false);
      return;
    }

    if (form.constructionYear) {
      const bagRow = buildNewBagDataRow(objectId, Number(form.constructionYear));
      const bagRes = await fetch(`/api/appsheet/${encodeURIComponent('BAG Data')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', rows: [bagRow] }),
      });
      if (!bagRes.ok) {
        // The building itself was created successfully — don't block
        // navigation over the year, just surface that it wasn't saved.
        setYearWarning('Building created, but the construction year could not be saved. You can add it later.');
      }
    }

    if (adres.toLowerCase().includes('niet gevonden')) {
      // Building was created (AppSheet's Add succeeded), but its own live
      // address-validation automation couldn't resolve the postcode/house
      // number and overwrote Adres — surface that rather than silently
      // navigating to a building with a broken address.
      setAddressWarning(
        `Building created, but AppSheet couldn't resolve this address (Adres now reads: "${adres}"). Double-check the postcode and house number on the building page.`
      );
      setLoading(false);
      return;
    }

    router.push(`/buildings/${objectId}`);
  }

  const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const labelClass = 'block text-xs font-medium text-gray-700 mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Objecttype</label>
          <select
            value={form.objecttype} onChange={e => set('objecttype', e.target.value as 'Woning' | 'Utiliteit')}
            className={inputClass}
          >
            <option value="Woning">Woning</option>
            <option value="Utiliteit">Utiliteit</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Bedrijf (organisation)</label>
          <select
            required value={form.bedrijfsId} onChange={e => set('bedrijfsId', e.target.value)}
            className={inputClass}
          >
            {orgs.length === 0 && <option value="">No organisations found</option>}
            {orgs.map(org => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="sm:col-span-2">
          <label className={labelClass}>Street</label>
          <input
            required value={form.street} onChange={e => set('street', e.target.value)}
            placeholder="Hoofdstraat"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>House number</label>
          <input
            required value={form.houseNumber} onChange={e => set('houseNumber', e.target.value)}
            placeholder="42"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Letter / addition</label>
          <div className="flex gap-1">
            <input
              value={form.houseLetter} onChange={e => set('houseLetter', e.target.value)}
              placeholder="A"
              className={inputClass}
            />
            <input
              value={form.houseAddition} onChange={e => set('houseAddition', e.target.value)}
              placeholder="bis"
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className={labelClass}>Postal code</label>
          <input
            required value={form.postalCode} onChange={e => set('postalCode', e.target.value)}
            placeholder="1234 AB" pattern="\d{4}\s?[A-Za-z]{2}" title="4 digits + 2 letters, e.g. 1234 AB"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>City</label>
          <input
            required value={form.city} onChange={e => set('city', e.target.value)}
            placeholder="Amsterdam"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Year built</label>
          <input
            type="number" min={1800} max={new Date().getFullYear()}
            value={form.constructionYear} onChange={e => set('constructionYear', e.target.value)}
            placeholder="1985"
            className={inputClass}
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}
      {addressWarning && (
        <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{addressWarning}</p>
      )}
      {yearWarning && (
        <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{yearWarning}</p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading || !form.bedrijfsId}
          className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors"
        >
          <Building2 className="w-4 h-4" />
          {loading ? 'Creating…' : 'Create building'}
        </button>
        <a
          href="/buildings"
          className="flex items-center text-sm font-medium px-5 py-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
