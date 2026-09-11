import type { BuildingSummary } from '@/lib/types';
import { GeocodeButton } from './GeocodeButton';

interface Props {
  building: Pick<BuildingSummary, 'id' | 'latitude' | 'longitude'>;
  // AppSheet-sourced buildings have nowhere to cache resolved coordinates —
  // the caller geocodes live on every render instead, so there's no
  // "fetch/refresh" action to offer here.
  showActions?: boolean;
}

// GAP W3 map: keyless OpenStreetMap embed driven by the cached
// buildings.latitude/longitude columns. No API key, and the page renders
// fine when OSM is unreachable (the browser just shows an empty iframe).
// Coordinates come from mobile GPS capture or the keyless PDOK geocode route.
export function MapPanel({ building: b, showActions = true }: Props) {
  const hasCoords = b.latitude != null && b.longitude != null;

  const d = 0.0015; // ~150 m viewport around the marker
  const bbox = hasCoords
    ? [b.longitude! - d, b.latitude! - d, b.longitude! + d, b.latitude! + d].join(',')
    : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">
          Locatie
          <span className="ml-2 font-normal text-gray-400 text-sm">Map</span>
        </h2>
        {showActions && <GeocodeButton buildingId={b.id} hasCoords={hasCoords} />}
      </div>

      {hasCoords ? (
        <div className="p-5">
          <iframe
            title="Kaart"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${b.latitude},${b.longitude}`}
            className="w-full h-64 rounded-lg border border-gray-100"
            loading="lazy"
          />
          <p className="mt-2 text-xs text-gray-500">
            {Number(b.latitude).toFixed(6)}, {Number(b.longitude).toFixed(6)} ·{' '}
            <a
              href={`https://www.openstreetmap.org/?mlat=${b.latitude}&mlon=${b.longitude}#map=18/${b.latitude}/${b.longitude}`}
              target="_blank" rel="noreferrer"
              className="text-indigo-600 hover:underline"
            >
              Bekijk op OpenStreetMap <span className="italic">(View on OpenStreetMap)</span>
            </a>
          </p>
        </div>
      ) : (
        <p className="px-5 py-6 text-sm text-gray-400">
          {showActions ? (
            <>
              Nog geen coördinaten voor dit adres — haal de locatie op om de kaart te tonen.
              <br />
              <span className="italic">No coordinates for this address yet — fetch the location to show the map.</span>
            </>
          ) : (
            <>
              Adres niet gevonden bij PDOK.
              <br />
              <span className="italic">Address not found at PDOK.</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
