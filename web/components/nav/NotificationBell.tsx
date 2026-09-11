'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell, Check, X } from 'lucide-react';
import { fmtDate } from '@/lib/format';
import { createClient } from '@/lib/supabase';

export interface PendingUser {
  id: string;
  full_name: string;
  created_at: string;
  status?: string;
}

export function NotificationBell({ pending: initialPending, orgId }: { pending: PendingUser[]; orgId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingUser[]>(initialPending);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Keep in sync with the server-fetched list on navigation/refresh (e.g.
  // after our own approve/reject calls router.refresh() below).
  useEffect(() => { setPending(initialPending); }, [initialPending]);

  // Live updates while an admin is already sitting on a dashboard page —
  // without this, a new signup request (or another admin approving one
  // elsewhere) would only show up on the next page load.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`pending-users:${orgId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_profiles', filter: `org_id=eq.${orgId}` },
        payload => {
          const row = payload.new as PendingUser;
          if (row.status === 'pending') {
            setPending(prev => prev.some(u => u.id === row.id) ? prev : [row, ...prev]);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'user_profiles', filter: `org_id=eq.${orgId}` },
        payload => {
          const row = payload.new as PendingUser;
          setPending(prev =>
            row.status === 'pending'
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
    setPending(prev => prev.filter(u => u.id !== id));
    await fetch(`/api/users/${id}/${action}`, { method: 'POST' });
    router.refresh();
    setBusyId(null);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
        aria-label="Pending user approvals"
      >
        <Bell className="w-4.5 h-4.5" />
        {pending.length > 0 && (
          <span className="absolute top-1 right-1 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none">
            {pending.length > 9 ? '9+' : pending.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 bg-white border border-gray-200 rounded-xl shadow-lg w-80 py-2 z-50 max-h-96 overflow-y-auto">
          <div className="px-4 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Pending approvals
          </div>
          {pending.length === 0 && (
            <p className="px-4 py-4 text-sm text-gray-400">No pending signups</p>
          )}
          {pending.map(u => (
            <div key={u.id} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-gray-50">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{u.full_name}</p>
                <p className="text-xs text-gray-400">Requested {fmtDate(u.created_at)}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handle(u.id, 'approve')}
                  disabled={busyId === u.id}
                  title="Approve"
                  className="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handle(u.id, 'reject')}
                  disabled={busyId === u.id}
                  title="Reject"
                  className="flex items-center justify-center w-7 h-7 rounded-full bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          <div className="border-t border-gray-100 mt-1 pt-1">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-indigo-600 hover:bg-gray-50 font-medium"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
