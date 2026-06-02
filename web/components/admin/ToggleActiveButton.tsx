'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

interface Props {
  table: 'user_profiles' | 'ble_devices';
  id: string;
  isActive: boolean;
}

export function ToggleActiveButton({ table, id, isActive }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handle() {
    if (!confirm(`${isActive ? 'Deactivate' : 'Activate'} this record?`)) return;
    setLoading(true);
    const supabase = createClient();
    await (supabase.from(table) as any).update({ is_active: !isActive }).eq('id', id);
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
