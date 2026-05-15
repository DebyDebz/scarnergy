"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddZoneButton({ buildingId }: { buildingId: string }) {
  const [open, setOpen]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm]   = useState({
    zone_code: "", name: "", floor_level: "0",
    gross_area_m2: "", ceiling_height_m: "", is_heated: "true",
  });
  const router = useRouter();

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm(f => ({ ...f, [key]: e.target.value })),
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/buildings/${buildingId}/zones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        floor_level:      Number(form.floor_level),
        gross_area_m2:    form.gross_area_m2    ? Number(form.gross_area_m2)    : null,
        ceiling_height_m: form.ceiling_height_m ? Number(form.ceiling_height_m) : null,
        is_heated:        form.is_heated === "true",
      }),
    });

    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(body.error ?? "Failed to add zone"); return; }
    setOpen(false);
    setForm({ zone_code: "", name: "", floor_level: "0", gross_area_m2: "", ceiling_height_m: "", is_heated: "true" });
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => { setError(null); setOpen(true); }}
        className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-semibold
                   hover:bg-brand-700 transition-colors"
      >
        + Add Zone
      </button>

      {open && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Add Zone</h2>
                <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
              </div>

              <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Zone Code</label>
                    <input {...field("zone_code")} required placeholder="Z01" className="input" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Floor Level</label>
                    <input {...field("floor_level")} type="number" className="input" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input {...field("name")} required placeholder="Begane grond" className="input" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Area m²</label>
                    <input {...field("gross_area_m2")} type="number" step="0.1" placeholder="45.5" className="input" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Ceiling height m</label>
                    <input {...field("ceiling_height_m")} type="number" step="0.01" placeholder="2.80" className="input" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Heated</label>
                  <select {...field("is_heated")} className="input bg-white">
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>

                {error && <p className="text-sm text-red-500">{error}</p>}

                <div className="flex justify-end gap-3 pt-1">
                  <button type="button" onClick={() => setOpen(false)}
                    className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={loading}
                    className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition-colors">
                    {loading ? "Adding…" : "Add Zone"}
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
