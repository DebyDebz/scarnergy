'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';

const BUILDING_TYPES: { value: string; label: string }[] = [
  { value: 'residential_single', label: 'Residential (single)' },
  { value: 'residential_multi',  label: 'Residential (multi)' },
  { value: 'apartment',          label: 'Apartment' },
  { value: 'office',             label: 'Office' },
  { value: 'retail',             label: 'Retail' },
  { value: 'industrial',         label: 'Industrial' },
  { value: 'mixed_use',          label: 'Mixed use' },
  { value: 'other',              label: 'Other' },
];

export function AddBuildingForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    reference_code: '',
    street: '',
    house_number: '',
    postal_code: '',
    city: '',
    building_type: 'residential_single',
    construction_year: new Date().getFullYear(),
    gross_floor_area_m2: '',
  });

  function set(field: string, value: string | number) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/buildings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        construction_year: Number(form.construction_year),
        gross_floor_area_m2: Number(form.gross_floor_area_m2),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? 'Failed to create building');
      setLoading(false);
    } else {
      router.push(`/buildings/${data.id}`);
    }
  }

  const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const labelClass = 'block text-xs font-medium text-gray-700 mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Reference code</label>
          <input
            required value={form.reference_code} onChange={e => set('reference_code', e.target.value)}
            placeholder="BLD-2024-001"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Building type</label>
          <select
            value={form.building_type} onChange={e => set('building_type', e.target.value)}
            className={inputClass}
          >
            {BUILDING_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
            required value={form.house_number} onChange={e => set('house_number', e.target.value)}
            placeholder="42A"
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Postal code</label>
          <input
            required value={form.postal_code} onChange={e => set('postal_code', e.target.value)}
            placeholder="1234 AB"
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
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Construction year</label>
          <input
            type="number" required min={1800} max={new Date().getFullYear()}
            value={form.construction_year} onChange={e => set('construction_year', e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Gross floor area (m²)</label>
          <input
            type="number" required min={1} step="0.01"
            value={form.gross_floor_area_m2} onChange={e => set('gross_floor_area_m2', e.target.value)}
            placeholder="250"
            className={inputClass}
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading}
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
