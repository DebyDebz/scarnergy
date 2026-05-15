"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ToggleDeviceButton({ deviceId, isActive }: { deviceId: string; isActive: boolean }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function toggle() {
    setLoading(true);
    await fetch(`/api/devices/${deviceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !isActive }),
    });
    setLoading(false);
    router.refresh();
  }

  const base = "text-xs font-semibold px-2 py-1 rounded-full transition-colors cursor-pointer disabled:opacity-50";

  if (isActive) {
    return (
      <button onClick={toggle} disabled={loading}
        className={`${base} bg-green-50 text-green-700 hover:bg-red-50 hover:text-red-600`}
        title="Click to deactivate">
        {loading ? "…" : "active"}
      </button>
    );
  }

  return (
    <button onClick={toggle} disabled={loading}
      className={`${base} bg-gray-100 text-gray-400 hover:bg-green-50 hover:text-green-700`}
      title="Click to activate">
      {loading ? "…" : "inactive"}
    </button>
  );
}
