'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildInspecteurEditRow } from '@/lib/appsheet/mappers';

// AppSheet-side counterpart to ChangeRoleButton. Inspecteurs' own "Rol"
// column only has two observed values (Inspecteur/Beheerder — see
// mapInspecteurRow's INSPECTEUR_ROLE_MAP), not ScanergyV2's three-way enum.
interface Props {
  inspecteurId: string;
  currentRol: 'Inspecteur' | 'Beheerder';
}

export function AppsheetChangeRoleButton({ inspecteurId, currentRol }: Props) {
  const router = useRouter();
  const [rol, setRol] = useState(currentRol);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleChange(newRol: 'Inspecteur' | 'Beheerder') {
    if (newRol === rol) return;
    setLoading(true);
    setError('');
    const res = await fetch('/api/appsheet/Inspecteurs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'edit', rows: [buildInspecteurEditRow(inspecteurId, { rol: newRol })] }),
    });
    if (res.ok) {
      setRol(newRol);
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Failed to update role');
    }
    setLoading(false);
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={rol}
        onChange={e => handleChange(e.target.value as 'Inspecteur' | 'Beheerder')}
        disabled={loading}
        className={`text-xs px-2 py-1 rounded-full font-medium border-0 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer disabled:opacity-60 ${
          rol === 'Beheerder' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
        }`}
      >
        <option value="Inspecteur">Inspecteur</option>
        <option value="Beheerder">Beheerder</option>
      </select>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
