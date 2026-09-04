'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, RotateCcw } from 'lucide-react';
import { fmtDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase';

export interface NotificationUser {
  id: string;
  full_name: string;
  created_at: string;
  status: string;
}

interface Props {
  orgId: string;
  initialPending: NotificationUser[];
  initialRejected: NotificationUser[];
}

export function NotificationsList({ orgId, initialPending, initialRejected }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(initialPending);
  const [rejected, setRejected] = useState(initialRejected);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => { setPending(initialPending); }, [initialPending]);
  useEffect(() => { setRejected(initialRejected); }, [initialRejected]);

  // Live updates while an admin is already on this page — same pattern as
  // the TopBar's NotificationBell.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications-page:${orgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_profiles', filter: `org_id=eq.${orgId}` },
        payload => {
          const row = payload.new as NotificationUser;
          if (!row?.id) return;
          setPending(prev =>
            row.status === 'pending'
              ? (prev.some(u => u.id === row.id) ? prev : [row, ...prev])
              : prev.filter(u => u.id !== row.id)
          );
          setRejected(prev =>
            row.status === 'rejected'
              ? (prev.some(u => u.id === row.id) ? prev : [row, ...prev])
              : prev.filter(u => u.id !== row.id)
          );
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orgId]);

  async function handle(id: string, action: 'approve' | 'reject') {
    setBusyId(id);
    await fetch(`/api/users/${id}/${action}`, { method: 'POST' });
    router.refresh();
    setBusyId(null);
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-sm">
            Pending requests {pending.length > 0 && <span className="text-gray-400 font-normal">({pending.length})</span>}
          </h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-100 text-left">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Requested</th>
              <th className="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {pending.map(u => (
              <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 text-gray-900 font-medium">{u.full_name}</td>
                <td className="px-5 py-3 text-gray-500 text-xs">{fmtDateTime(u.created_at)}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handle(u.id, 'approve')}
                      disabled={busyId === u.id}
                      className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => handle(u.id, 'reject')}
                      disabled={busyId === u.id}
                      className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!pending.length && (
              <tr>
                <td colSpan={3} className="px-5 py-8 text-center text-gray-400">No pending requests</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-sm">Rejected requests</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-100 text-left">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Requested</th>
              <th className="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rejected.map(u => (
              <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 text-gray-900 font-medium">{u.full_name}</td>
                <td className="px-5 py-3 text-gray-500 text-xs">{fmtDateTime(u.created_at)}</td>
                <td className="px-5 py-3">
                  <button
                    onClick={() => handle(u.id, 'approve')}
                    disabled={busyId === u.id}
                    className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-emerald-100 hover:text-emerald-700 disabled:opacity-50 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Re-approve
                  </button>
                </td>
              </tr>
            ))}
            {!rejected.length && (
              <tr>
                <td colSpan={3} className="px-5 py-8 text-center text-gray-400">No rejected requests</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
