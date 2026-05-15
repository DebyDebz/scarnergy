"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function InviteInspectorButton() {
  const [open, setOpen]         = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<{ email: string; password: string } | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const router = useRouter();

  function handleOpen() {
    setFullName("");
    setEmail("");
    setResult(null);
    setError(null);
    setOpen(true);
  }

  function handleDone() {
    setOpen(false);
    setResult(null);
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/inspectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: fullName, email }),
    });

    const body = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(body.error ?? "Failed to invite inspector");
      return;
    }

    setResult({ email, password: body.temporary_password });
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold
                   hover:bg-brand-700 transition-colors"
      >
        + Invite Inspector
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={!result ? () => setOpen(false) : undefined}
          />

          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md">

              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Invite Inspector</h2>
                {!result && (
                  <button
                    onClick={() => setOpen(false)}
                    className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                  >
                    &times;
                  </button>
                )}
              </div>

              {result ? (
                <div className="px-6 py-5 space-y-4">
                  <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-lg p-4">
                    <span className="text-green-600 text-lg mt-0.5">✓</span>
                    <div>
                      <p className="text-sm font-semibold text-green-800">Inspector invited successfully</p>
                      <p className="text-sm text-green-700 mt-1">
                        Share these login credentials with {fullName}:
                      </p>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Email</p>
                      <p className="font-mono text-sm text-gray-800">{result.email}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Temporary password</p>
                      <p className="font-mono text-sm font-bold text-gray-800 tracking-wide">
                        {result.password}
                      </p>
                    </div>
                  </div>

                  <p className="text-xs text-gray-400">
                    Ask the inspector to change their password after first login.
                  </p>

                  <div className="flex justify-end pt-1">
                    <button
                      onClick={handleDone}
                      className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold
                                 hover:bg-brand-700 transition-colors"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={e => setFullName(e.target.value)}
                      required
                      placeholder="e.g. Jan de Vries"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm
                                 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      placeholder="e.g. jan@krontiva.nl"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm
                                 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>

                  {error && <p className="text-sm text-red-500">{error}</p>}

                  <div className="flex justify-end gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600
                                 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold
                                 hover:bg-brand-700 disabled:opacity-50 transition-colors"
                    >
                      {loading ? "Inviting…" : "Invite"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
