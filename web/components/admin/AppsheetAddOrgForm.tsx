'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building, Plus } from 'lucide-react';
import { buildNewBedrijfRow } from '@/lib/appsheet/mappers';

// AppSheet-side counterpart to AddOrgForm — name-only, since the Bedrijven
// sheet has no address/coordinates/linked-buildings columns at all (see
// mapBedrijvenRow). `existingIds` comes from the org list already loaded by
// organizations/page.tsx, so buildNewBedrijfRow can compute the next
// sequential "Bedrijf ID" without an extra fetch.
export function AppsheetAddOrgForm({ existingIds }: { existingIds: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const row = buildNewBedrijfRow(name, existingIds);
    const res = await fetch('/api/appsheet/Bedrijven', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', rows: [row] }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data.error ?? 'Failed to create organisation');
      setLoading(false);
      return;
    }
    setName('');
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
      >
        <Plus className="w-4 h-4" />
        New organisation
      </button>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-5">
        <div className="bg-indigo-100 rounded-lg p-2">
          <Building className="w-4 h-4 text-indigo-600" />
        </div>
        <h2 className="font-semibold text-gray-900 text-sm">New organisation (AppSheet)</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Company Name <span className="text-red-500">*</span>
          </label>
          <input
            required
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Acme Inspections BV"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="mt-1.5 text-xs text-gray-400">
            Address, coordinates, and linked buildings aren&apos;t available for AppSheet-sourced organisations.
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            <Building className="w-4 h-4" />
            {loading ? 'Creating…' : 'Create organisation'}
          </button>
          <button
            type="button"
            onClick={() => { setName(''); setError(''); setOpen(false); }}
            className="text-sm font-medium px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
