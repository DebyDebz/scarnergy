'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Loader2, AlertTriangle, X } from 'lucide-react';

// AppSheet-side counterpart to DeleteSessionButton. A pseudo-session here
// IS the Objecten (building) row, so this can't delete a session record
// the way ScanergyV2 does — it calls PATCH /api/appsheet/Objecten, which
// resets Status back to "Nieuw" and leaves the building and its Opname
// Datum/Tijd untouched (confirmed live: Opname Datum is a required column
// and can't be blanked). Matches ScanergyV2's own session delete in intent
// — it's a soft reset, not a destructive removal — without actually
// deleting the building, which is a distinct, bigger action already
// covered by the buildings page's delete.
export function AppsheetDeleteSessionButton({
  objectId,
  sessionCode,
}: {
  objectId: string;
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
    const res = await fetch('/api/appsheet/Objecten', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objectId }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Failed to reset session');
      setLoading(false);
      return;
    }

    setOpen(false);
    setLoading(false);
    router.refresh();
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
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={closeModal}
          />

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
                  AppSheet models this visit on the building itself, so this resets its Status
                  back to &quot;Nieuw&quot; rather than deleting the building. The building and its
                  visit date are not removed.
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
                    Resetting…
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
