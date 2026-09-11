'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MapPin } from 'lucide-react';

interface Props {
  buildingId: string;
  hasCoords: boolean;
}

const ERROR_MESSAGES: Record<string, string> = {
  geocode_unavailable: 'Geocodeerservice (PDOK) is momenteel niet bereikbaar (Geocoding service (PDOK) is currently unreachable)',
  address_not_found: 'Adres niet gevonden bij PDOK (Address not found at PDOK)',
};

export function GeocodeButton({ buildingId, hasCoords }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleClick() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/buildings/${buildingId}/geocode`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(ERROR_MESSAGES[data.error] ?? data.error ?? 'Locatie ophalen mislukt (Failed to fetch location)');
        return;
      }
      router.refresh();
    } catch {
      setError('Locatie ophalen mislukt — controleer de verbinding (Failed to fetch location — check your connection)');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={loading}
        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {loading
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <MapPin className="w-3.5 h-3.5" />}
        {hasCoords ? (
          <>Locatie vernieuwen <span className="italic font-normal text-gray-500">(Refresh location)</span></>
        ) : (
          <>Locatie ophalen <span className="italic font-normal text-gray-500">(Fetch location)</span></>
        )}
      </button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
