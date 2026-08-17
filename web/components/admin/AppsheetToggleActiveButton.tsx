'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildInspecteurEditRow } from '@/lib/appsheet/mappers';

// AppSheet-side counterpart to ToggleActiveButton, writing Inspecteurs'
// "Actief" column (Y / blank — see mapInspecteurRow) through the edit action
// instead of a direct Supabase update.
export function AppsheetToggleActiveButton({ inspecteurId, isActive }: { inspecteurId: string; isActive: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handle() {
    if (!confirm(`${isActive ? 'Deactivate' : 'Activate'} this inspecteur?`)) return;
    setLoading(true);
    await fetch('/api/appsheet/Inspecteurs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'edit', rows: [buildInspecteurEditRow(inspecteurId, { actief: !isActive })] }),
    });
    router.refresh();
    setLoading(false);
  }

  return (
    <button
      onClick={handle}
      disabled={loading}
      className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
        isActive
          ? 'bg-emerald-100 text-emerald-700 hover:bg-red-100 hover:text-red-700'
          : 'bg-gray-100 text-gray-500 hover:bg-emerald-100 hover:text-emerald-700'
      }`}
    >
      {loading ? '…' : isActive ? 'Active' : 'Inactive'}
    </button>
  );
}
