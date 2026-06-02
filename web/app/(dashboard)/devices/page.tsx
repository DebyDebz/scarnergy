import { createClient } from '@/lib/supabase-server';
import { ToggleActiveButton } from '@/components/admin/ToggleActiveButton';
import { RegisterDeviceForm } from '@/components/admin/RegisterDeviceForm';
import { Bluetooth, BatteryLow, BatteryFull, BatteryMedium } from 'lucide-react';
import type { BleDevice, UserProfile } from '@/lib/types';

export const revalidate = 0;

function BatteryIcon({ level }: { level: number | null }) {
  if (level === null) return <span className="text-gray-300">—</span>;
  const Icon = level < 20 ? BatteryLow : level < 60 ? BatteryMedium : BatteryFull;
  const color = level < 20 ? 'text-red-500' : level < 60 ? 'text-amber-500' : 'text-emerald-500';
  return (
    <span className={`flex items-center gap-1 text-xs ${color}`}>
      <Icon className="w-4 h-4" />
      {level}%
    </span>
  );
}

export default async function DevicesPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const profileResult = await supabase
    .from('user_profiles')
    .select('org_id')
    .eq('id', user!.id)
    .single() as unknown as { data: Pick<UserProfile, 'org_id'> | null };

  const devicesResult = await supabase
    .from('ble_devices')
    .select('*')
    .eq('org_id', profileResult.data!.org_id)
    .order('nickname') as unknown as { data: BleDevice[] | null };

  const devices = devicesResult.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">BLE Devices</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {devices?.length ?? 0} registered · {devices?.filter(d => d.is_active).length ?? 0} active
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Bluetooth className="w-4 h-4 text-indigo-600" />
          <h2 className="font-semibold text-gray-900 text-sm">Register new device</h2>
        </div>
        <RegisterDeviceForm orgId={profileResult.data!.org_id} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-100 text-left">
              <th className="px-5 py-3 font-medium">Nickname</th>
              <th className="px-5 py-3 font-medium">MAC address</th>
              <th className="px-5 py-3 font-medium">Battery</th>
              <th className="px-5 py-3 font-medium">Last connected</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(devices ?? []).map(d => (
              <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 font-medium text-gray-900">{d.nickname}</td>
                <td className="px-5 py-3 font-mono text-xs text-gray-500">{d.mac_address}</td>
                <td className="px-5 py-3">
                  <BatteryIcon level={d.battery_level} />
                </td>
                <td className="px-5 py-3 text-gray-500 text-xs">
                  {d.last_connected_at
                    ? new Date(d.last_connected_at).toLocaleString('en-GB', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                      })
                    : '—'}
                </td>
                <td className="px-5 py-3">
                  <ToggleActiveButton table="ble_devices" id={d.id} isActive={d.is_active} />
                </td>
              </tr>
            ))}
            {!devices?.length && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-gray-400">No devices registered</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
