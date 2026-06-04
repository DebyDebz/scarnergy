'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { Trash2, Loader2, AlertTriangle, X } from 'lucide-react';

export function DeleteSessionButton({
  sessionId,
  sessionCode,
}: {
  sessionId: string;
  sessionCode: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function closeModal() {
    if (loading) return;
    setOpen(false);
    setError('');
  }

  async function handleDelete() {
    setLoading(true);
    setError('');
    const supabase = createClient();
    // Soft-delete: flag inactive instead of hard-deleting, so measurements
    // aren't cascade-wiped. Hidden everywhere by the summary views' is_active filter.
    const { error: err, count } = await (supabase.from('inspection_sessions') as any)
      .update({ is_active: false }, { count: 'exact' })
      .eq('id', sessionId);

    if (err) {
      setError(err.message);
      setLoading(false);
    } else if (!count) {
      setError('You are not permitted to delete this session.');
      setLoading(false);
    } else {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`Delete ${sessionCode}`}
        aria-label={`Delete session ${sessionCode}`}
        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-session-title"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={closeModal}
          />

          {/* Popup */}
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 p-6 text-left">
            <button
              onClick={closeModal}
              disabled={loading}
              aria-label="Close"
              className="absolute top-4 right-4 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div className="min-w-0">
                <h2
                  id="delete-session-title"
                  className="text-base font-semibold text-gray-900"
                >
                  Delete session {sessionCode}?
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  This permanently removes the session and all its measurements.
                  This action cannot be undone.
                </p>
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-600 mt-4 bg-red-50 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={closeModal}
                disabled={loading}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
