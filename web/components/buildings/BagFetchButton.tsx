'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';

interface Props {
  buildingId: string;
  hasData: boolean;
}

const ERROR_MESSAGES: Record<string, string> = {
  bag_unavailable: 'BAG-service is momenteel niet bereikbaar (BAG service is currently unreachable)',
  address_not_found: 'Adres niet gevonden in de BAG (Address not found in the BAG)',
  bag_not_configured: 'BAG API-sleutel niet geconfigureerd (BAG API key not configured)',
};

const WARNING_MESSAGES: Record<string, string> = {
  meerdere_verblijfsobjecten: 'Meerdere verblijfsobjecten op dit adres — eerste gebruikt (Multiple residential units at this address — first one used)',
  meerdere_panden: 'Meerdere panden voor dit verblijfsobject — eerste gebruikt (Multiple buildings for this unit — first one used)',
  toevoeging_genegeerd: 'Huisnummertoevoeging niet gevonden — genegeerd (House number suffix not found — ignored)',
  '3dbag_unavailable': '3DBAG-hoogte niet beschikbaar (3DBAG height not available)',
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
    try {
      const res = await fetch(`/api/buildings/${buildingId}/bag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: hasData }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(ERROR_MESSAGES[data.error] ?? data.error ?? 'Ophalen mislukt (Fetch failed)');
        return;
      }
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      router.refresh();
    } catch {
      setError('Ophalen mislukt — controleer de verbinding (Fetch failed — check your connection)');
    } finally {
      setLoading(false);
    }
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
        {hasData ? (
          <>Vernieuwen <span className="italic font-normal text-gray-500">(Refresh)</span></>
        ) : (
          <>Ophalen <span className="italic font-normal text-gray-500">(Fetch)</span></>
        )}
      </button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      {warnings.map(w => (
        <p key={w} className="text-xs text-amber-600">{WARNING_MESSAGES[w] ?? w}</p>
      ))}
    </div>
  );
}
