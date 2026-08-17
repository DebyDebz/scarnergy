import { ExternalLink } from 'lucide-react';
import type { BuildingSummary } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { BagFetchButton } from './BagFetchButton';

type BagPanelBuilding = Pick<
  BuildingSummary,
  'id' | 'bag_pand_id' | 'bag_vbo_id' | 'bag_bouwjaar' | 'bag_oppervlakte_m2' |
  'bag_gebruiksdoel' | 'dbag_hoogte_m' | 'bag_fetched_at'
>;

interface Props {
  building: BagPanelBuilding;
  // AppSheet-sourced buildings already carry real BAG data straight from
  // the "BAG Data" sheet (see mapObjectenRow) — there's no on-demand
  // fetch/cache to refresh, so no BagFetchButton for that mode.
  showActions?: boolean;
}

// Server component: renders only the cached buildings columns (migration
// 026), so the panel is unaffected by BAG/3DBAG availability. Fetch/refresh
// goes through the BagFetchButton → POST /api/buildings/[id]/bag.
export function BagPanel({ building: b, showActions = true }: Props) {
  // bag_fetched_at is a Scanergy-only cache-staleness marker — AppSheet rows
  // never set it even when bag_pand_id (and the rest) is genuinely present,
  // so presence of the pand id is the real "has data" signal in both modes.
  const hasData = b.bag_pand_id != null;

  const rows: Array<{ label: string; labelEn: string; value: string | null }> = [
    { label: 'BAG Bouwjaar', labelEn: 'Year built', value: b.bag_bouwjaar != null ? String(b.bag_bouwjaar) : null },
    { label: 'BAG Oppervlakte', labelEn: 'Surface area', value: b.bag_oppervlakte_m2 != null ? `${b.bag_oppervlakte_m2} m²` : null },
    { label: '3DBAG Hoogte', labelEn: 'Height', value: b.dbag_hoogte_m != null ? `${b.dbag_hoogte_m} m` : null },
    { label: 'BAG Gebruiksdoel', labelEn: 'Usage purpose', value: b.bag_gebruiksdoel },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">
          BAG en 3DBAG gegevens
          <span className="ml-2 font-normal text-gray-400 text-sm">Public building registry</span>
        </h2>
        {showActions && <BagFetchButton buildingId={b.id} hasData={hasData} />}
      </div>

      <div className="px-5 py-4">
        {hasData ? (
          <>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
              {rows.map(r => (
                <div key={r.label}>
                  <dt className="text-[11px] text-gray-400">
                    {r.label} <span className="italic">({r.labelEn})</span>
                  </dt>
                  <dd className="text-xs font-medium text-gray-800">{r.value ?? '—'}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
              <span>
                BAG Pand ID <span className="italic">(Building ID)</span>:{' '}
                <span className="font-mono text-gray-700">{b.bag_pand_id ?? '—'}</span>
              </span>
              {b.bag_pand_id && (
                <>
                  <a
                    href={`https://bagviewer.kadaster.nl/lvbag/bag-viewer/?searchQuery=${b.bag_pand_id}`}
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
                  >
                    BAG Viewer <ExternalLink className="w-3 h-3" />
                  </a>
                  <a
                    href={`https://3dbag.nl/en/download?tid=NL.IMBAG.Pand.${b.bag_pand_id}`}
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
                  >
                    3DBAG <ExternalLink className="w-3 h-3" />
                  </a>
                </>
              )}
              {b.bag_fetched_at != null && (
                <span className="ml-auto">
                  Opgehaald <span className="italic">(Fetched)</span>: {fmtDate(b.bag_fetched_at)}
                </span>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-400">
            Nog geen BAG-gegevens opgehaald voor dit adres.
            <br />
            <span className="italic">No BAG data retrieved for this address yet.</span>
          </p>
        )}
      </div>
    </div>
  );
}
