'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { BluetoothSearching } from 'lucide-react';

export function RegisterDeviceForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [mac, setMac] = useState('');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const supabase = createClient();
    const { error: err } = await (supabase.from('ble_devices') as any).insert({
      org_id: orgId,
      mac_address: mac.toUpperCase(),
      nickname,
      is_active: true,
    });
    if (err) setError(err.message);
    else { setMac(''); setNickname(''); router.refresh(); }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">MAC address</label>
        <input
          required value={mac} onChange={e => setMac(e.target.value)}
          placeholder="AA:BB:CC:DD:EE:FF"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 w-48"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Nickname</label>
        <input
          required value={nickname} onChange={e => setNickname(e.target.value)}
          placeholder="GLM-50C #1"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-44"
        />
      </div>
      <button
        type="submit" disabled={loading}
        className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors"
      >
        <BluetoothSearching className="w-4 h-4" />
        {loading ? 'Registering…' : 'Register device'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
