'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { buildNewInspecteurRow } from '@/lib/appsheet/mappers';
import type { Organisation } from '@/lib/types';

interface Props {
  orgs: Organisation[];
}

// AppSheet-side counterpart to InviteUserForm. Adds an Inspecteurs row
// directly (no invite email — AppSheet has no auth/invite concept, this is
// a plain data row) via POST /api/appsheet/Inspecteurs, admin-gated. "Rol"
// here is Inspecteurs' own two observed values (Inspecteur/Beheerder), not
// ScanergyV2's inspector/supervisor/admin enum — see
// lib/appsheet/mappers.ts mapInspecteurRow for the mapping back.
export function AppsheetInviteUserForm({ orgs }: Props) {
  const router = useRouter();
  const [naam, setNaam] = useState('');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<'Inspecteur' | 'Beheerder'>('Inspecteur');
  const [bedrijfId, setBedrijfId] = useState(orgs[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    const row = buildNewInspecteurRow({ naam, email, rol, bedrijfId });
    const res = await fetch('/api/appsheet/Inspecteurs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', rows: [row] }),
    });
    const data = await res.json();

    setResult({
      ok: res.ok,
      msg: res.ok ? `${naam} added to AppSheet (Inspecteurs)` : (data.error ?? 'Failed to add user'),
    });
    if (res.ok) {
      setNaam('');
      setEmail('');
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Full name</label>
        <input
          required value={naam} onChange={e => setNaam(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-44"
          placeholder="Jane Doe"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
        <input
          type="email" required value={email} onChange={e => setEmail(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-52"
          placeholder="user@example.com"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Bedrijf (Company)</label>
        <select
          required value={bedrijfId} onChange={e => setBedrijfId(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {orgs.length === 0 && <option value="">No organisations found</option>}
          {orgs.map(org => (
            <option key={org.id} value={org.id}>{org.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Rol (Role)</label>
        <select
          value={rol} onChange={e => setRol(e.target.value as 'Inspecteur' | 'Beheerder')}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="Inspecteur">Inspecteur (Inspector)</option>
          <option value="Beheerder">Beheerder (Administrator)</option>
        </select>
      </div>
      <button
        type="submit" disabled={loading || !bedrijfId}
        className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors"
      >
        <UserPlus className="w-4 h-4" />
        {loading ? 'Adding…' : 'Add user'}
      </button>
      {result && (
        <p className={`text-sm ${result.ok ? 'text-emerald-600' : 'text-red-600'}`}>{result.msg}</p>
      )}
    </form>
  );
}
