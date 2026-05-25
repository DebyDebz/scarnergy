'use client';
import { useState } from 'react';
import { UserPlus } from 'lucide-react';

export function InviteUserForm({ orgId }: { orgId: string }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'inspector' | 'supervisor'>('inspector');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    const res = await fetch('/api/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, full_name: name, role, org_id: orgId }),
    });
    const data = await res.json();
    setResult({ ok: res.ok, msg: res.ok ? `Invite sent to ${email}` : data.error });
    if (res.ok) { setEmail(''); setName(''); }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Full name</label>
        <input
          required value={name} onChange={e => setName(e.target.value)}
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
        <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
        <select
          value={role} onChange={e => setRole(e.target.value as 'inspector' | 'supervisor')}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="inspector">Inspector</option>
          <option value="supervisor">Supervisor</option>
        </select>
      </div>
      <button
        type="submit" disabled={loading}
        className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors"
      >
        <UserPlus className="w-4 h-4" />
        {loading ? 'Sending…' : 'Send invite'}
      </button>
      {result && (
        <p className={`text-sm ${result.ok ? 'text-emerald-600' : 'text-red-600'}`}>{result.msg}</p>
      )}
    </form>
  );
}
