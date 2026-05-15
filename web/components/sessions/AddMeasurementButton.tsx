"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ElementOption {
  id: string;
  name: string;
  element_type: string;
}

const ANOMALY_THRESHOLD = 50000;

export function AddMeasurementButton({
  sessionId,
  elements,
}: {
  sessionId: string;
  elements: ElementOption[];
}) {
  const [open, setOpen]     = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [valueMm, setValueMm] = useState("");
  const [elementId, setElementId] = useState("");
  const router = useRouter();

  const parsed    = Number(valueMm);
  const isAnomaly = valueMm !== "" && !isNaN(parsed) && (parsed < 0 || parsed > ANOMALY_THRESHOLD);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valueMm || isNaN(parsed)) return;
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/sessions/${sessionId}/measurements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        value_mm:   parsed,
        element_id: elementId || null,
      }),
    });

    const body = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(body.error ?? "Failed to add measurement");
      return;
    }

    setValueMm("");
    setElementId("");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => { setError(null); setOpen(true); }}
        className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600
                   hover:bg-gray-50 transition-colors"
      >
        + Add Measurement
      </button>

      {open && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Add Measurement</h2>
                <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
              </div>

              <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Value (mm)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={valueMm}
                    onChange={e => setValueMm(e.target.value)}
                    required
                    placeholder="245.00"
                    className={`input ${isAnomaly ? "border-orange-400 ring-1 ring-orange-300" : ""}`}
                  />
                  {isAnomaly && (
                    <p className="text-xs text-orange-500 mt-1">
                      ⚠ Value outside normal range — will be flagged as anomaly
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Element <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <select
                    value={elementId}
                    onChange={e => setElementId(e.target.value)}
                    className="input bg-white"
                  >
                    <option value="">— no element —</option>
                    {elements.map(el => (
                      <option key={el.id} value={el.id}>
                        [{el.element_type}] {el.name}
                      </option>
                    ))}
                  </select>
                </div>

                {error && <p className="text-sm text-red-500">{error}</p>}

                <div className="flex justify-end gap-3 pt-1">
                  <button type="button" onClick={() => setOpen(false)}
                    className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={loading || !valueMm}
                    className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition-colors">
                    {loading ? "Saving…" : "Save"}
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
