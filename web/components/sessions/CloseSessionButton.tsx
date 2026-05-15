"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CloseSessionButton({ sessionId }: { sessionId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const router = useRouter();

  async function handleClose() {
    if (!confirm("Close this session? This cannot be undone.")) return;
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/sessions/${sessionId}/close`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to close session");
      setLoading(false);
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClose}
        disabled={loading}
        className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold
                   hover:bg-red-700 disabled:opacity-50 transition-colors"
      >
        {loading ? "Closing…" : "Close Session"}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
