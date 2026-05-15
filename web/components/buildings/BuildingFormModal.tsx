"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Building } from "@/lib/types";

const BUILDING_TYPES = [
  { value: "residential_single", label: "Residential — Single family" },
  { value: "residential_multi",  label: "Residential — Multi family" },
  { value: "apartment",          label: "Apartment" },
  { value: "office",             label: "Office" },
  { value: "retail",             label: "Retail" },
  { value: "industrial",         label: "Industrial" },
  { value: "mixed_use",          label: "Mixed use" },
  { value: "other",              label: "Other" },
];

interface Props {
  building?: Building;  // present → edit mode, absent → create mode
  trigger: React.ReactNode;
}

export function BuildingFormModal({ building, trigger }: Props) {
  const isEdit = !!building;
  const [open, setOpen] = useState(false);

  const [form, setForm] = useState({
    reference_code:    building?.reference_code    ?? "",
    street:            building?.street            ?? "",
    house_number:      building?.house_number      ?? "",
    postal_code:       building?.postal_code       ?? "",
    city:              building?.city              ?? "",
    building_type:     building?.building_type     ?? "",
    construction_year: building?.construction_year?.toString() ?? "",
    gross_floor_area_m2: building?.gross_floor_area_m2?.toString() ?? "",
    num_floors:        "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const router = useRouter();

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm(f => ({ ...f, [key]: e.target.value })),
    };
  }

  function handleOpen() {
    setError(null);
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const url    = isEdit ? `/api/buildings/${building!.id}` : "/api/buildings";
    const method = isEdit ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        construction_year:   Number(form.construction_year),
        gross_floor_area_m2: form.gross_floor_area_m2 ? Number(form.gross_floor_area_m2) : undefined,
      }),
    });

    const body = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(body.error ?? "Something went wrong");
      return;
    }

    setOpen(false);
    if (!isEdit && body.id) {
      router.push(`/buildings/${body.id}`);
    } else {
      router.refresh();
    }
  }

  return (
    <>
      <span onClick={handleOpen} className="contents">{trigger}</span>

      {open && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setOpen(false)} />

          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">

              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
                <h2 className="text-lg font-semibold text-gray-900">
                  {isEdit ? "Edit Building" : "Add Building"}
                </h2>
                <button
                  onClick={() => setOpen(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                >
                  &times;
                </button>
              </div>

              <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Reference Code</label>
                    <input
                      {...field("reference_code")}
                      required
                      placeholder="BLD-2026-001"
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Building Type</label>
                    <select {...field("building_type")} required className="input bg-white">
                      <option value="">Select type…</option>
                      {BUILDING_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Street</label>
                    <input {...field("street")} required placeholder="Herengracht" className="input" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Number</label>
                    <input {...field("house_number")} required placeholder="182" className="input" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Postal Code</label>
                    <input {...field("postal_code")} required placeholder="1016 BR" className="input" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                    <input {...field("city")} required placeholder="Amsterdam" className="input" />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Built year</label>
                    <input
                      {...field("construction_year")}
                      required
                      type="number"
                      min={1800}
                      max={new Date().getFullYear()}
                      placeholder="1975"
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Floor area m²</label>
                    <input
                      {...field("gross_floor_area_m2")}
                      type="number"
                      min={1}
                      step="0.1"
                      placeholder="120"
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Floors</label>
                    <input
                      {...field("num_floors")}
                      type="number"
                      min={1}
                      placeholder="3"
                      className="input"
                    />
                  </div>
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
                    {loading ? "Saving…" : isEdit ? "Save Changes" : "Add Building"}
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
