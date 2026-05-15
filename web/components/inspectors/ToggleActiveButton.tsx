"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  inspectorId: string;
  isActive: boolean;
}

export function ToggleActiveButton({ inspectorId, isActive }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleToggle() {
    setLoading(true);
    await fetch(`/api/inspectors/${inspectorId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !isActive }),
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      title={isActive ? "Click to deactivate" : "Click to activate"}
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold
                  transition-colors disabled:opacity-50 cursor-pointer
                  ${isActive
                    ? "bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-600"
                    : "bg-gray-100 text-gray-400 hover:bg-green-100 hover:text-green-700"
                  }`}
    >
      {loading ? "…" : isActive ? "active" : "inactive"}
    </button>
  );
}
