"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EnergyLabelBadge } from "./EnergyLabelBadge";

const LABELS = ["A++++", "A+++", "A++", "A+", "A", "B", "C", "D", "E", "F", "G"] as const;

export function ZoneEnergyLabelSelect({
  zoneId,
  current,
}: {
  zoneId: string;
  current: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const router = useRouter();

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const label = e.target.value || null;
    setSaving(true);
    await fetch(`/api/zones/${zoneId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ energy_label: label }),
    });
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <select
        autoFocus
        defaultValue={current ?? ""}
        onChange={handleChange}
        onBlur={() => setEditing(false)}
        disabled={saving}
        className="border border-brand-500 rounded px-1 py-0.5 text-xs focus:outline-none"
      >
        <option value="">— none —</option>
        {LABELS.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      title="Click to set energy label"
      className="cursor-pointer hover:opacity-75 transition-opacity"
    >
      <EnergyLabelBadge label={current} />
    </button>
  );
}
