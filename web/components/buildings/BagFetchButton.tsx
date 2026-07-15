'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';

interface Props {
  buildingId: string;
  hasData: boolean;
}

const ERROR_MESSAGES: Record<string, string> = {
  bag_unavailable: 'BAG-service is momenteel niet bereikbaar',
  address_not_found: 'Adres niet gevonden in de BAG',
  bag_not_configured: 'BAG API-sleutel niet geconfigureerd',
};

const WARNING_MESSAGES: Record<string, string> = {
  meerdere_verblijfsobjecten: 'Meerdere verblijfsobjecten op dit adres — eerste gebruikt',
  meerdere_panden: 'Meerdere panden voor dit verblijfsobject — eerste gebruikt',
  toevoeging_genegeerd: 'Huisnummertoevoeging niet gevonden — genegeerd',
  '3dbag_unavailable': '3DBAG-hoogte niet beschikbaar',
};

export function BagFetchButton({ buildingId, hasData }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);

  async function handleFetch() {
    setLoading(true);
    setError('');
    setWarnings([]);
    const res = await fetch(`/api/buildings/${buildingId}/bag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: hasData }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(ERROR_MESSAGES[data.error] ?? data.error ?? 'Ophalen mislukt');
      return;
    }
    setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleFetch}
        disabled={loading}
        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {loading
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <RefreshCw className="w-3.5 h-3.5" />}
        {hasData ? 'Vernieuwen' : 'Ophalen'}
      </button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      {warnings.map(w => (
        <p key={w} className="text-xs text-amber-600">{WARNING_MESSAGES[w] ?? w}</p>
      ))}
    </div>
  );
}
