"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ELEMENT_TYPES = [
  { value: "gevel",           label: "Gevel (Wall / Facade)" },
  { value: "dak",             label: "Dak (Roof)" },
  { value: "vloer",           label: "Vloer (Floor)" },
  { value: "installatie",     label: "Installatie (HVAC)" },
  { value: "transparant_deel", label: "Transparant deel (Window / Door)" },
];

export function AddElementButton({ zoneId }: { zoneId: string }) {
  const [open, setOpen]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm]   = useState({
    element_type: "", name: "", rc_value: "", construction_type: "",
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

    const res = await fetch(`/api/zones/${zoneId}/elements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        element_type:     form.element_type,
        name:             form.name,
        rc_value:         form.rc_value ? Number(form.rc_value) : null,
        construction_type: form.construction_type || null,
      }),
    });

    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(body.error ?? "Failed to add element"); return; }
    setOpen(false);
    setForm({ element_type: "", name: "", rc_value: "", construction_type: "" });
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => { setError(null); setOpen(true); }}
        className="px-2 py-1 rounded text-xs text-brand-500 border border-brand-200
                   hover:bg-brand-50 transition-colors"
      >
        + Element
      </button>

      {open && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Add Element</h2>
                <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
              </div>

              <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Element Type</label>
                  <select {...field("element_type")} required className="input bg-white">
                    <option value="">Select type…</option>
                    {ELEMENT_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input {...field("name")} required placeholder="Voorgevel (Noord)" className="input" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Rc value <span className="text-gray-400 font-normal">(m²K/W)</span>
                    </label>
                    <input {...field("rc_value")} type="number" step="0.01" placeholder="2.5" className="input" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Construction type</label>
                    <input {...field("construction_type")} placeholder="Spouwmuur 1975" className="input" />
                  </div>
                </div>

                {error && <p className="text-sm text-red-500">{error}</p>}

                <div className="flex justify-end gap-3 pt-1">
                  <button type="button" onClick={() => setOpen(false)}
                    className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={loading}
                    className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition-colors">
                    {loading ? "Adding…" : "Add Element"}
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
