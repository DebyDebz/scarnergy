"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface BuildingOption {
  id: string;
  reference_code: string;
  street: string;
  house_number: string;
  city: string;
}

interface InspectorOption {
  id: string;
  full_name: string;
}

interface Props {
  buildings: BuildingOption[];
  inspectors: InspectorOption[];
}

export function NewSessionButton({ buildings, inspectors }: Props) {
  const [open, setOpen]             = useState(false);
  const [buildingId, setBuildingId] = useState("");
  const [inspectorId, setInspectorId] = useState("");
  const [notes, setNotes]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const router = useRouter();

  function handleOpen() {
    setBuildingId("");
    setInspectorId("");
    setNotes("");
    setError(null);
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!buildingId || !inspectorId) return;
    setLoading(true);
    setError(null);

    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ building_id: buildingId, inspector_id: inspectorId, notes }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to create session");
      setLoading(false);
      return;
    }

    const { id } = await res.json();
    router.push(`/sessions/${id}`);
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold
                   hover:bg-brand-700 transition-colors"
      >
        + New Session
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setOpen(false)}
          />

          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md">

              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">New Inspection Session</h2>
                <button
                  onClick={() => setOpen(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                >
                  &times;
                </button>
              </div>

              <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Building
                  </label>
                  <select
                    value={buildingId}
                    onChange={e => setBuildingId(e.target.value)}
                    required
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                  >
                    <option value="">Select a building…</option>
                    {buildings.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.reference_code} — {b.street} {b.house_number}, {b.city}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Inspector
                  </label>
                  <select
                    value={inspectorId}
                    onChange={e => setInspectorId(e.target.value)}
                    required
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                  >
                    <option value="">Select an inspector…</option>
                    {inspectors.map(i => (
                      <option key={i.id} value={i.id}>{i.full_name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Any notes about this inspection…"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-500">{error}</p>
                )}

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
                    disabled={loading || !buildingId || !inspectorId}
                    className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold
                               hover:bg-brand-700 disabled:opacity-50 transition-colors"
                  >
                    {loading ? "Creating…" : "Create Session"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}
    </>
  );
}
