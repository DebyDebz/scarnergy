'use client';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { EnergyLabelSnapshot } from '@/lib/types';
import { fmtDate } from '@/lib/format';

interface Props {
  snapshots: EnergyLabelSnapshot[];
}

// Best → worst, same ordering as supabase/functions/energy_label_estimate —
// keep in sync with that ladder so a chart point always maps back correctly.
const LABEL_ORDER = ['A++++', 'A+++', 'A++', 'A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];

export function EnergyLabelTrendChart({ snapshots }: Props) {
  const data = [...snapshots]
    .sort((a, b) => new Date(a.computed_at).getTime() - new Date(b.computed_at).getTime())
    .map(s => ({
      t: fmtDate(s.computed_at),
      label: s.energy_label,
      value: LABEL_ORDER.indexOf(s.energy_label),
    }))
    .filter(d => d.value !== -1);

  if (!data.length) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-gray-400">
        No label history yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="t" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis
          tick={{ fontSize: 11 }}
          width={40}
          domain={[0, LABEL_ORDER.length - 1]}
          ticks={LABEL_ORDER.map((_, i) => i)}
          tickFormatter={(v) => LABEL_ORDER[v] ?? ''}
          reversed
        />
        <Tooltip
          formatter={(_v, _n, item: any) => [item.payload.label, 'Label']}
          labelFormatter={l => `Date: ${l}`}
        />
        <Line
          type="stepAfter"
          dataKey="value"
          stroke="#1E3A5F"
          strokeWidth={2}
          dot={(props) => {
            const { cx, cy, payload } = props;
            return <circle key={payload.t} cx={cx} cy={cy} r={4} fill="#f59e0b" stroke="white" strokeWidth={1.5} />;
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
