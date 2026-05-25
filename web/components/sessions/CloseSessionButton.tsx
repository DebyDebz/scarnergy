'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { XCircle } from 'lucide-react';

export function CloseSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleClose() {
    if (!confirm('Close this session? This action cannot be undone.')) return;
    setLoading(true);
    setError('');
    const supabase = createClient();
    const { error: err } = await (supabase.rpc as any)('close_inspection_session', { p_session_id: sessionId });
    if (err) {
      setError(err.message);
      setLoading(false);
    } else {
      router.refresh();
    }
  }

  return (
    <div>
      <button
        onClick={handleClose}
        disabled={loading}
        className="flex items-center gap-2 bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-60 transition-colors"
      >
        <XCircle className="w-4 h-4" />
        {loading ? 'Closing…' : 'Close session'}
      </button>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
