"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { Measurement } from "@/lib/types";

interface Props {
  measurements: Measurement[];
}

export function MeasurementChart({ measurements }: Props) {
  if (measurements.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-gray-300 italic">
        No data yet
      </div>
    );
  }

  const data = [...measurements]
    .sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime())
    .map(m => ({
      t:     new Date(m.measured_at).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      value: m.value_mm,
      anomaly: m.is_anomaly,
    }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="t" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10 }} unit=" mm" width={64} />
        <Tooltip
          formatter={(val: number) => [`${val.toFixed(1)} mm`, "Value"]}
          contentStyle={{ fontSize: 12 }}
        />
        <ReferenceLine y={50000} stroke="#E67E22" strokeDasharray="4 4" label={{ value: "max", fontSize: 10 }} />
        <Line
          type="monotone"
          dataKey="value"
          stroke="#2E86C1"
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
