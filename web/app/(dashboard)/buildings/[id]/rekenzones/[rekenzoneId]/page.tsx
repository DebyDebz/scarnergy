import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { ElementTypeSections, type ElementWithRelations } from '@/components/elements/ElementTypeSections';
import { ArrowLeft } from 'lucide-react';
import type { BuildingSummary, Rekenzone, Zone, BuildingElement, Opening } from '@/lib/types';
import { fmtArea } from '@/lib/calc';

interface Props { params: { id: string; rekenzoneId: string } }

// AppSheet "Rekenzones Read only" parity (GAP.md W5): pools every member
// element across all of a rekenzone's verdiepingen into one consolidated
// Gevels/Daken/Vloeren/Installaties view, reusing the same row components as
// the per-zone accordion. Read-only — no schema change, no new mutation path.
export default async function RekenzoneDetailPage({ params }: Props) {
  const supabase = await createClient();

  const [buildingResult, rekenzoneResult] = await Promise.all([
    supabase.from('building_summary').select('*').eq('id', params.id).single(),
    (supabase.from('rekenzones') as any)
      .select('*').eq('id', params.rekenzoneId).eq('building_id', params.id).single(),
  ]);

  const building = (buildingResult as unknown as { data: BuildingSummary | null }).data;
  const rekenzone = (rekenzoneResult as unknown as { data: Rekenzone | null }).data;
  if (!building || !rekenzone) notFound();

  const zonesResult = await (supabase.from('zones') as any)
    .select('*').eq('rekenzone_id', params.rekenzoneId).order('floor_level');
  const zones = (zonesResult as unknown as { data: Zone[] | null }).data ?? [];
  const zoneIds = zones.map(z => z.id);

  let elements: BuildingElement[] = [];
  let openings: Opening[] = [];
  if (zoneIds.length > 0) {
    const [elemRes, openRes] = await Promise.all([
      (supabase.from('building_elements') as any)
        .select('*').in('zone_id', zoneIds).eq('is_active', true).order('sort_order'),
      (supabase.from('openings') as any)
        .select('*').eq('is_active', true),
    ]);
    elements = elemRes.data ?? [];
    const elIds = new Set(elements.map((e: BuildingElement) => e.id));
    openings = (openRes.data ?? []).filter((o: any) => elIds.has(o.element_id));
  }

  const openingsByElement = openings.reduce<Record<string, Opening[]>>((acc, o) => {
    const key = (o as any).element_id as string;
    (acc[key] ??= []).push(o);
    return acc;
  }, {});
  const dakkapellenByParent = elements
    .filter(e => e.element_type === 'dakkapel' && e.parent_element_id)
    .reduce<Record<string, BuildingElement[]>>((acc, dk) => {
      (acc[dk.parent_element_id as string] ??= []).push(dk);
      return acc;
    }, {});

  // Pooled across every verdieping in this rekenzone — the point of this view.
  const pooledElements: ElementWithRelations[] = elements.map(e => ({
    ...e,
    openings: openingsByElement[e.id] ?? [],
    dakkapellen: dakkapellenByParent[e.id] ?? [],
  }));

  const elementPhotoUrls: Record<string, string[]> = {};
  await Promise.all(
    elements
      .filter(e => (e.photo_urls ?? []).length > 0)
      .map(async e => {
        const urls = await Promise.all(
          (e.photo_urls ?? []).map(async p => {
            if (p.startsWith('http')) return p;
            if (p.startsWith('file:')) return null;
            const { data } = await supabase.storage.from('inspection-photos').createSignedUrl(p, 3600);
            return data?.signedUrl ?? null;
          })
        );
        const signed = urls.filter((u): u is string => !!u);
        if (signed.length > 0) elementPhotoUrls[e.id] = signed;
      })
  );

  const totalArea = zones.reduce((sum, z) => sum + (z.gross_area_m2 ?? 0), 0);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link
          href={`/buildings/${params.id}`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3"
        >
          <ArrowLeft className="w-4 h-4" /> {building.full_address}
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{rekenzone.name}</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Rekenzone
              <span className="mx-1.5">·</span>
              {zones.length} {zones.length === 1 ? 'verdieping' : 'verdiepingen'}
              <span className="mx-1.5">·</span>
              {fmtArea(totalArea)}
            </p>
          </div>
        </div>
        {rekenzone.notes && <p className="text-sm text-gray-600 mt-2">{rekenzone.notes}</p>}
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Verdiepingen</h2>
        </div>
        <div className="px-5 py-3 flex flex-wrap gap-2">
          {zones.map(z => (
            <span key={z.id} className="text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-1">
              {z.name}
            </span>
          ))}
          {!zones.length && <p className="text-sm text-gray-400 italic">No verdiepingen assigned to this rekenzone</p>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">
            Elementen
            <span className="ml-2 font-normal text-gray-400 text-sm">
              Pooled across all verdiepingen in this rekenzone — read only
            </span>
          </h2>
        </div>
        <div className="p-5">
          <ElementTypeSections elements={pooledElements} photoUrls={elementPhotoUrls} readOnly />
        </div>
      </div>
    </div>
  );
}
