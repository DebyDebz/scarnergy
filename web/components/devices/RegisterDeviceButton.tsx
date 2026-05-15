"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RegisterDeviceButton() {
  const [open, setOpen]     = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [form, setForm]     = useState({ mac_address: "", nickname: "" });
  const router = useRouter();

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm(f => ({ ...f, [key]: e.target.value })),
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(body.error ?? "Failed to register device"); return; }
    setOpen(false);
    setForm({ mac_address: "", nickname: "" });
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => { setError(null); setOpen(true); }}
        className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold
                   hover:bg-brand-700 transition-colors"
      >
        + Register Device
      </button>

      {open && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Register BLE Device</h2>
                <button onClick={() => setOpen(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
              </div>

              <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">MAC Address</label>
                  <input
                    {...field("mac_address")}
                    required
                    placeholder="AA:BB:CC:DD:EE:FF"
                    pattern="([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}"
                    className="input font-mono"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Find this via <code className="bg-gray-100 px-1 rounded">./start-bridge.sh --scan</code> or{" "}
                    <code className="bg-gray-100 px-1 rounded">bluetoothctl</code>
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nickname</label>
                  <input {...field("nickname")} placeholder="GLM-01" className="input" />
                </div>

                {error && <p className="text-sm text-red-500">{error}</p>}

                <div className="flex justify-end gap-3 pt-1">
                  <button type="button" onClick={() => setOpen(false)}
                    className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600
                               hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={loading}
                    className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold
                               hover:bg-brand-700 disabled:opacity-50 transition-colors">
                    {loading ? "Registering…" : "Register"}
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
