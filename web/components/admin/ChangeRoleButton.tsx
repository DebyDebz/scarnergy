'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@/lib/types';

interface Props {
  userId: string;
  currentRole: Role;
}

export function ChangeRoleButton({ userId, currentRole }: Props) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(currentRole);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleChange(newRole: Role) {
    if (newRole === role) return;
    setLoading(true);
    setError('');
    const res = await fetch(`/api/users/${userId}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    if (res.ok) {
      setRole(newRole);
      router.refresh();
    } else {
      const data = await res.json();
      setError(data.error ?? 'Failed to update role');
    }
    setLoading(false);
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={role}
        onChange={e => handleChange(e.target.value as Role)}
        disabled={loading}
        className={`text-xs px-2 py-1 rounded-full font-medium border-0 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer disabled:opacity-60 ${
          role === 'admin' ? 'bg-purple-100 text-purple-700' :
          role === 'supervisor' ? 'bg-blue-100 text-blue-700' :
          'bg-gray-100 text-gray-600'
        }`}
      >
        <option value="inspector">inspector</option>
        <option value="supervisor">supervisor</option>
        <option value="admin">admin</option>
      </select>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
