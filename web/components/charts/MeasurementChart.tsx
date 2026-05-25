'use client';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { Measurement } from '@/lib/types';

interface Props {
  measurements: Measurement[];
}

export function MeasurementChart({ measurements }: Props) {
  const data = [...measurements]
    .sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime())
    .map(m => ({
      t: new Date(m.measured_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      value: Math.round(m.value_mm),
      anomaly: m.is_anomaly,
    }));

  if (!data.length) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-gray-400">
        No measurements to chart
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="t" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11 }} unit=" mm" width={64} />
        <Tooltip
          formatter={(v) => [`${v} mm`, 'Value']}
          labelFormatter={l => `Time: ${l}`}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke="#6366f1"
          strokeWidth={2}
          dot={(props) => {
            const { cx, cy, payload } = props;
            if (payload.anomaly) {
              return <circle key={payload.t} cx={cx} cy={cy} r={5} fill="#f59e0b" stroke="white" strokeWidth={2} />;
            }
            return <circle key={payload.t} cx={cx} cy={cy} r={3} fill="#6366f1" />;
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
