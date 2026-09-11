import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase-server';
import type { Building, BuildingElement, BuildingFacadePhoto, Opening, Organisation, Zone } from '@/lib/types';
import { PrintButton } from '@/components/print/PrintButton';

const DIRECTIONS: { key: BuildingFacadePhoto['direction']; label: string }[] = [
  { key: 'voor',   label: 'Voorgevel'    },
  { key: 'achter', label: 'Achtergevel'  },
  { key: 'links',  label: 'Linkergevel'  },
  { key: 'rechts', label: 'Rechtergevel' },
];

function fitPointsSvg(raw: Array<{x:number;y:number}>, w: number, h: number): string {
  if (!raw || raw.length < 3) return '';
  const pad = 8;
  const xs = raw.map(p=>p.x), ys = raw.map(p=>p.y);
  const minX=Math.min(...xs), rX=(Math.max(...xs)-minX)||1;
  const minY=Math.min(...ys), rY=(Math.max(...ys)-minY)||1;
  const scale=Math.min((w-pad*2)/rX,(h-pad*2)/rY);
  const ox=pad+((w-pad*2)-rX*scale)/2, oy=pad+((h-pad*2)-rY*scale)/2;
  return raw.map(p=>`${(ox+(p.x-minX)*scale).toFixed(1)},${(oy+(p.y-minY)*scale).toFixed(1)}`).join(' ');
}

interface Props { params: { id: string } }

// This route renders standalone print output but still lives under the app's
// single root layout (app/layout.tsx already emits <html><body>) — so the
// title goes through generateMetadata instead of a literal <title> tag, which
// would otherwise nest a second <html><head> inside the root <body> and break
// hydration (server/browser disagree on where <style> ends up).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const supabase = await createClient();
  const { data: session } = await (supabase.from('session_summary') as any)
    .select('building_address, building_city')
    .eq('id', params.id)
    .single();
  if (!session) return { title: 'Opname Rapport' };
  return { title: `Opname Rapport — ${session.building_address}, ${session.building_city}` };
}

// ── Cardinal direction ────────────────────────────────────────────────────
function toCardinal(deg: number | null): string {
  if (deg == null) return '—';
  const d = ((deg % 360) + 360) % 360;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(d / 45) % 8];
}

function m(mm: number | null | undefined, digits = 2): string {
  if (mm == null) return '—';
  return `${(mm / 1000).toFixed(digits)} m`;
}
function m2(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${Number(v.toFixed(2))} m²`;
}
function deg(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v}°`;
}
function fmt(v: unknown): string {
  if (v == null || v === '') return '—';
  return String(v);
}

function floorName(level: number): string {
  if (level === 0) return 'Begane grond (Bg)';
  if (level === 1) return 'Eerste verdieping (V1)';
  if (level === 2) return 'Tweede verdieping / Zolder (V2)';
  return `Verdieping ${level}`;
}

export default async function PrintReportPage({ params }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return notFound();

  // ── Fetch all data ──────────────────────────────────────────────────
  const [sessionRes, orgRes] = await Promise.all([
    (supabase.from('session_summary') as any).select('*').eq('id', params.id).single(),
    (supabase.from('organisations') as any).select('*').single(),
  ]);

  const session = sessionRes.data;
  if (!session) notFound();

  const org: Organisation | null = orgRes.data ?? null;

  const [buildingRes, facadeRes] = await Promise.all([
    (supabase.from('buildings') as any).select('*').eq('id', session.building_id).single(),
    (supabase.from('building_facade_photos') as any).select('*').eq('building_id', session.building_id).order('direction'),
  ]);
  const building: Building | null = buildingRes.data ?? null;
  const facadePhotosRaw: BuildingFacadePhoto[] = facadeRes.data ?? [];

  // Sign facade photo URLs
  const facadeByDir: Record<string, string | null> = {};
  await Promise.all(facadePhotosRaw.map(async p => {
    if (p.photo_url.startsWith('http')) { facadeByDir[p.direction] = p.photo_url; return; }
    const { data } = await supabase.storage.from('facade-photos').createSignedUrl(p.photo_url, 3600);
    facadeByDir[p.direction] = data?.signedUrl ?? null;
  }));

  const zonesRes = await (supabase.from('zones') as any)
    .select('*')
    .eq('building_id', session.building_id)
    .eq('is_active', true)
    .order('floor_level');
  const zones: Zone[] = zonesRes.data ?? [];
  const zoneIds = zones.map((z: Zone) => z.id);

  let elements: BuildingElement[] = [];
  let openings: Opening[] = [];

  if (zoneIds.length) {
    const [elemRes, openRes] = await Promise.all([
      (supabase.from('building_elements') as any)
        .select('*').in('zone_id', zoneIds).eq('is_active', true).order('element_type').order('sort_order'),
      (supabase.from('openings') as any)
        .select('*').eq('is_active', true),
    ]);
    elements = elemRes.data ?? [];
    const elementIds = new Set(elements.map((e: BuildingElement) => e.id));
    openings = (openRes.data ?? []).filter((o: any) => elementIds.has(o.element_id));
  }

  const openingsByElement: Record<string, Opening[]> = {};
  for (const o of openings) {
    (openingsByElement[(o as any).element_id] ??= []).push(o);
  }

  const gevels       = elements.filter(e => e.element_type === 'gevel');
  const vloeren      = elements.filter(e => e.element_type === 'vloer');
  const daken        = elements.filter(e => e.element_type === 'dak');
  const installaties = elements.filter(e => e.element_type === 'installatie');

  const totalArea = zones.reduce((s: number, z: Zone) => s + (z.gross_area_m2 ?? 0), 0);
  const surveyDate = session.started_at
    ? new Date(session.started_at).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';

  const address = `${session.building_address}, ${session.building_city}`;

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <>
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #111; background: white; }
          h1 { font-size: 18pt; margin-bottom: 4pt; color: #3f8fa8; font-weight: 400; }
          h2 { font-size: 14pt; margin: 16pt 0 8pt; color: #111; font-weight: 400; }
          h3 { font-size: 9.5pt; margin: 10pt 0 4pt; color: #333; }
          h4 { font-size: 9pt; margin: 8pt 0 3pt; color: #333; }
          table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-bottom: 8pt; }
          th { background: #5b9db3; color: #111; padding: 3pt 5pt; text-align: left; font-weight: 700; }
          td { padding: 2.5pt 5pt; border-bottom: 0.5pt solid #ddd; vertical-align: top; }
          tr:nth-child(even) td { background: #f7f8fb; }
          .koptekst-table td { border: 0.5pt solid #ccc; }
          .koptekst-table td:first-child { font-weight: 700; width: 160pt; background: #5b9db3; color: #111; }
          .instal-table th { background: #fbe4c9; color: #111; }
          .page-break { page-break-before: always; }
          .section { margin-bottom: 18pt; }
          .badge { display: inline-block; padding: 1pt 5pt; border-radius: 3pt; font-size: 7.5pt; font-weight: 700; }
          .badge-complete { background: #d1fae5; color: #065f46; }
          .badge-incomplete { background: #fef3c7; color: #92400e; }
          .label-a { background:#1a9e48; color:white; }
          .label-b { background:#56bc2a; color:white; }
          .label-c { background:#a0c832; color:white; }
          .label-d { background:#f5d800; color:#333; }
          .label-e { background:#f5a800; color:white; }
          .label-f { background:#f05a00; color:white; }
          .label-g { background:#d00; color:white; }
          .subhead { font-size: 8pt; color: #666; margin-bottom: 6pt; }
          .warn { color: #b45309; font-size: 7.5pt; }
          .photos-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 8pt; margin-bottom: 8pt; }
          .photo-cell { text-align: center; }
          .photo-cell img { width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: 3pt; border: .5pt solid #ccc; }
          .photo-cell .dir { font-size: 7.5pt; font-weight: 600; color: #3f8fa8; margin-top: 3pt; }
          .photo-placeholder { width: 100%; aspect-ratio: 4/3; background: #f3f4f6; border: .5pt dashed #ccc; border-radius: 3pt; display: flex; align-items: center; justify-content: center; color: #ccc; font-size: 8pt; }
          .fp-wrap { position: relative; display: inline-block; border: .5pt solid #ccc; border-radius: 3pt; overflow: hidden; }
          .fp-wrap img { display: block; }
          .fp-wrap svg { position: absolute; top: 0; left: 0; pointer-events: none; }
          .fp-scale { background: rgba(0,0,0,.4); color: #fff; font-size: 7pt; font-weight: 600; padding: 2pt 5pt; text-align: center; }
          @page { size: A4; margin: 15mm 18mm; }
          @media print {
            .no-print { display: none; }
            a { color: inherit; text-decoration: none; }
          }
        `}</style>

        {/* Print button — hidden when printing */}
        <PrintButton hint="Use your browser's Print → Save as PDF" padding="12px" />

        {/* ── Section 1 — Header ────────────────────────────────────── */}
        <div className="section">
          <h1>Opname Rapport</h1>
          <p className="subhead">Energetische opname conform NTA 8800 / NEN 2580</p>
          <table className="koptekst-table" style={{ marginTop: '8pt', maxWidth: '360pt' }}>
            <tbody>
              <tr><td>Locatie</td><td>{address}</td></tr>
              <tr><td>Datum opname</td><td>{surveyDate}</td></tr>
              <tr><td>Opname gedaan door</td><td>{fmt(session.inspector_name)}</td></tr>
              <tr><td>Bedrijf</td><td>{fmt(org?.name)}</td></tr>
              {building?.construction_year && <tr><td>Bouwjaar</td><td>{building.construction_year}</td></tr>}
              {building?.building_type && <tr><td>Gebouwtype</td><td>{building.building_type}</td></tr>}
              <tr><td>Sessie</td><td style={{ fontFamily: 'monospace' }}>{session.session_code}</td></tr>
              <tr><td>Status</td><td>{session.status}</td></tr>
            </tbody>
          </table>
        </div>

        {/* ── Section 2 — Gevel Foto's ─────────────────────────────── */}
        <div className="section">
          <h2>2. Gevel Foto&apos;s buitenzijde</h2>
          <div className="photos-grid">
            {DIRECTIONS.map(({ key, label }) => {
              const url = facadeByDir[key];
              return (
                <div key={key} className="photo-cell">
                  {url
                    ? <img src={url} alt={label} />
                    : <div className="photo-placeholder">Niet opgenomen</div>
                  }
                  <div className="dir">{label}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Section 3 — Gebruiksoppervlakte ──────────────────────── */}
        <div className="section">
          <h2>3. Gebruiksoppervlakte (Usable Floor Areas)</h2>
          <table>
            <thead>
              <tr>
                <th>Verdieping</th>
                <th>Omschrijving</th>
                <th>Zone</th>
                <th style={{ textAlign: 'right' }}>Gebruiksoppervlakte (m²)</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z: Zone) => (
                <tr key={z.id}>
                  <td>{floorName(z.floor_level)}</td>
                  <td>{z.name}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '7.5pt' }}>{z.zone_code}</td>
                  <td style={{ textAlign: 'right' }}>{m2(z.gross_area_m2)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} style={{ fontWeight: 700 }}>Totaal</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{m2(totalArea)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── Section 4 — Overzicht Plattegronden ──────────────────── */}
        {zones.some((z: Zone) => z.floor_plan_image_url) && (
          <div className="section">
            <h2>4. Overzicht Plattegronden</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12pt' }}>
              {zones.filter((z: Zone) => z.floor_plan_image_url).map((z: Zone) => {
                const CANVAS_W = 260, CANVAS_H = 195;
                const pts = z.floor_plan_points ? fitPointsSvg(z.floor_plan_points, CANVAS_W, CANVAS_H) : '';
                const scaleLabel = z.floor_plan_scale_m
                  ? `Schaal: 1 cel ≈ ${(z.floor_plan_scale_m / ((CANVAS_W - 16) / 20)).toFixed(2)} m`
                  : '';
                return (
                  <div key={z.id} style={{ display: 'flex', flexDirection: 'column', gap: '4pt' }}>
                    <div style={{ fontSize: '8pt', fontWeight: 700, color: '#1e3a5f' }}>{z.name}</div>
                    <div className="fp-wrap">
                      <img src={z.floor_plan_image_url!} alt={`Plattegrond ${z.name}`}
                        style={{ width: CANVAS_W, height: CANVAS_H, objectFit: 'cover' }} />
                      {pts && (
                        <svg width={CANVAS_W} height={CANVAS_H}>
                          <polygon points={pts} fill="rgba(30,58,95,0.12)" stroke="#1e3a5f" strokeWidth={1.5} strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    {scaleLabel && <div className="fp-scale">{scaleLabel}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Section 5a — Gevels Overzichtstabel ──────────────────── */}
        {gevels.length > 0 && (
          <div className="section">
            <h2>5a. Gevels — Overzichtstabel (Wall Summary)</h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: '80pt' }}>ID</th>
                  <th>Naam</th>
                  <th>Positie</th>
                  <th>Orientatie</th>
                  <th>H × B (m)</th>
                  <th style={{ textAlign: 'right' }}>Opp. (m²)</th>
                  <th>Grenzend aan</th>
                  <th>Rc (m²K/W)</th>
                  <th>U (W/m²K)</th>
                </tr>
              </thead>
              <tbody>
                {gevels.map(el => (
                  <tr key={el.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '7pt' }}>{el.id.slice(0, 8)}</td>
                    <td>{el.name}</td>
                    <td>{fmt(el.construction_type)}</td>
                    <td>{toCardinal(el.orientation_deg)}</td>
                    <td>{el.height_mm != null && el.length_mm != null ? `${m(el.height_mm)} × ${m(el.length_mm)}` : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{m2(el.area_m2)}</td>
                    <td>{fmt(el.description)}</td>
                    <td>{fmt(el.rc_value)}</td>
                    <td>{fmt(el.u_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Section 5b — Vloeren Overzichtstabel ─────────────────── */}
        {vloeren.length > 0 && (
          <div className="section">
            <h2>5b. Vloeren — Overzichtstabel (Floor Summary)</h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: '80pt' }}>ID</th>
                  <th>Naam</th>
                  <th>Grenst aan</th>
                  <th>Vloerisolatie</th>
                  <th>Bodemisolatie</th>
                  <th style={{ textAlign: 'right' }}>Oppervlakte (m²)</th>
                  <th>Rc (m²K/W)</th>
                </tr>
              </thead>
              <tbody>
                {vloeren.map(el => (
                  <tr key={el.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '7pt' }}>{el.id.slice(0, 8)}</td>
                    <td>{el.name}</td>
                    <td>{fmt(el.description)}</td>
                    <td>{el.insulation_type ? 'Ja' : <span className="warn">Nee</span>}</td>
                    <td><span className="warn">Nee</span></td>
                    <td style={{ textAlign: 'right' }}>{m2(el.area_m2)}</td>
                    <td>{fmt(el.rc_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Section 5c — Daken Overzichtstabel ───────────────────── */}
        {daken.length > 0 && (
          <div className="section">
            <h2>5c. Daken — Overzichtstabel (Roof Summary)</h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: '80pt' }}>ID</th>
                  <th>Naam</th>
                  <th>Positie</th>
                  <th>Type</th>
                  <th>Hoek</th>
                  <th>Orientatie</th>
                  <th style={{ textAlign: 'right' }}>Netto Opp. (m²)</th>
                  <th>Rc (m²K/W)</th>
                </tr>
              </thead>
              <tbody>
                {daken.map(el => (
                  <tr key={el.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '7pt' }}>{el.id.slice(0, 8)}</td>
                    <td>{el.name}</td>
                    <td>{fmt(el.construction_type)}</td>
                    <td>{el.tilt_deg != null && el.tilt_deg < 5 ? 'PlatDak' : 'HellendDak'}</td>
                    <td>{deg(el.tilt_deg)}</td>
                    <td>{toCardinal(el.orientation_deg)}</td>
                    <td style={{ textAlign: 'right' }}>{m2(el.area_m2)}</td>
                    <td>{fmt(el.rc_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Section 5d — Detail Gevels ────────────────────────────── */}
        {gevels.length > 0 && (
          <div className="section page-break">
            <h2>5d. Gedetailleerde Uitwerking — Gevels (Wall Detail)</h2>
            {gevels.map(el => {
              const elOpenings = openingsByElement[el.id] ?? [];
              return (
                <div key={el.id} style={{ marginBottom: '16pt', border: '0.5pt solid #ccc', padding: '8pt' }}>
                  <h3>{el.name}</h3>
                  <table style={{ marginBottom: '6pt' }}>
                    <tbody>
                      <tr><td style={{ fontWeight: 600, width: '150pt' }}>Gevel ID</td><td style={{ fontFamily: 'monospace', fontSize: '7.5pt' }}>{el.id}</td></tr>
                      <tr><td style={{ fontWeight: 600 }}>Positie</td><td>{fmt(el.construction_type)}</td></tr>
                      <tr><td style={{ fontWeight: 600 }}>Orientatie</td><td>{toCardinal(el.orientation_deg)}</td></tr>
                      <tr><td style={{ fontWeight: 600 }}>Afmetingen (H×B)</td><td>{el.height_mm != null && el.length_mm != null ? `${m(el.height_mm)} × ${m(el.length_mm)}` : '—'}</td></tr>
                      <tr><td style={{ fontWeight: 600 }}>Oppervlakte</td><td>{m2(el.area_m2)}</td></tr>
                      <tr><td style={{ fontWeight: 600 }}>Grenzend aan</td><td>{fmt(el.description)}</td></tr>
                      <tr><td style={{ fontWeight: 600 }}>Rc-waarde</td><td>{el.rc_value != null ? `${el.rc_value} m²K/W` : '—'}</td></tr>
                      <tr><td style={{ fontWeight: 600 }}>U-waarde</td><td>{el.u_value != null ? `${el.u_value} W/m²K` : '—'}</td></tr>
                      {el.insulation_type && <tr><td style={{ fontWeight: 600 }}>Isolatietype</td><td>{el.insulation_type}</td></tr>}
                      {el.notes && <tr><td style={{ fontWeight: 600 }}>Notities</td><td>{el.notes}</td></tr>}
                    </tbody>
                  </table>

                  {elOpenings.length > 0 && (
                    <>
                      <h4>Transparante Delen (Windows / Doors)</h4>
                      <table>
                        <thead>
                          <tr>
                            <th>Type</th>
                            <th>H × B (m)</th>
                            <th style={{ textAlign: 'right' }}>Opp (m²)</th>
                            <th>Kozijn</th>
                            <th>Beglazing</th>
                            <th>Zonwering</th>
                            <th>U-totaal (W/m²K)</th>
                            <th>Notities</th>
                          </tr>
                        </thead>
                        <tbody>
                          {elOpenings.map(o => {
                            const area = o.area_m2 ?? (o.height_mm != null && o.width_mm != null
                              ? Number(((o.height_mm / 1000) * (o.width_mm / 1000)).toFixed(2))
                              : null);
                            const isEnkel = (o.glazing_type ?? '').toLowerCase().includes('enkel') || (o.glazing_type ?? '').toLowerCase().includes('single');
                            return (
                              <tr key={o.id}>
                                <td>{fmt(o.opening_type)}</td>
                                <td>{o.height_mm != null && o.width_mm != null ? `${m(o.height_mm)} × ${m(o.width_mm)}` : '—'}</td>
                                <td style={{ textAlign: 'right' }}>{m2(area)}</td>
                                <td>{fmt(o.frame_type)}</td>
                                <td style={{ color: isEnkel ? '#b45309' : 'inherit', fontWeight: isEnkel ? 700 : 400 }}>
                                  {fmt(o.glazing_type)}
                                </td>
                                <td>{o.has_shading ? fmt(o.shading_type) : 'Geen'}</td>
                                <td>{fmt(o.u_value_total)}</td>
                                <td>{fmt(o.notes)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </>
                  )}
                  {elOpenings.length === 0 && (
                    <p style={{ fontSize: '8pt', color: '#888', fontStyle: 'italic' }}>Geen transparante delen geregistreerd.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Section 5e — Detail Daken ─────────────────────────────── */}
        {daken.length > 0 && (
          <div className="section">
            <h2>5e. Gedetailleerde Uitwerking — Daken (Roof Detail)</h2>
            {daken.map(el => (
              <div key={el.id} style={{ marginBottom: '16pt', border: '0.5pt solid #ccc', padding: '8pt' }}>
                <h3>{el.name}</h3>
                <table>
                  <tbody>
                    <tr><td style={{ fontWeight: 600, width: '150pt' }}>Dak ID</td><td style={{ fontFamily: 'monospace', fontSize: '7.5pt' }}>{el.id}</td></tr>
                    <tr><td style={{ fontWeight: 600 }}>Type dak</td><td>{el.tilt_deg != null && el.tilt_deg < 5 ? 'PlatDak' : 'HellendDak'}</td></tr>
                    <tr><td style={{ fontWeight: 600 }}>Orientatie</td><td>{toCardinal(el.orientation_deg)}</td></tr>
                    <tr><td style={{ fontWeight: 600 }}>Hoek</td><td>{deg(el.tilt_deg)}</td></tr>
                    <tr><td style={{ fontWeight: 600 }}>Lengte × Breedte</td><td>{el.length_mm != null && el.width_mm != null ? `${m(el.length_mm)} × ${m(el.width_mm)}` : '—'}</td></tr>
                    <tr><td style={{ fontWeight: 600 }}>Netto oppervlak</td><td>{m2(el.area_m2)}</td></tr>
                    <tr><td style={{ fontWeight: 600 }}>Rc-waarde</td><td>{el.rc_value != null ? `${el.rc_value} m²K/W` : '—'}</td></tr>
                    <tr><td style={{ fontWeight: 600 }}>U-waarde</td><td>{el.u_value != null ? `${el.u_value} W/m²K` : '—'}</td></tr>
                    {el.insulation_type && <tr><td style={{ fontWeight: 600 }}>Isolatietype</td><td>{el.insulation_type}</td></tr>}
                    {el.notes && <tr><td style={{ fontWeight: 600 }}>Notities</td><td>{el.notes}</td></tr>}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {/* ── Section 6 — Installaties ──────────────────────────────── */}
        {installaties.length > 0 && (
          <div className="section">
            <h2>6. Bijbehorende Installaties (Building Services)</h2>
            <table className="instal-table">
              <thead>
                <tr>
                  <th style={{ width: '80pt' }}>ID</th>
                  <th>Type</th>
                  <th>Naam / Merk</th>
                  <th>Brandstof</th>
                  <th>Vermogen (kW)</th>
                  <th>Rendement</th>
                  <th>Locatie</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {installaties.map(el => (
                  <tr key={el.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '7pt' }}>{el.id.slice(0, 8)}</td>
                    <td>{fmt(el.installation_type)}</td>
                    <td>{el.name}</td>
                    <td>{fmt(el.fuel_type)}</td>
                    <td>{fmt(el.capacity_kw)}</td>
                    <td>{el.efficiency != null ? `${(Number(el.efficiency) * 100).toFixed(0)}%` : '—'}</td>
                    <td>{fmt(el.description)}</td>
                    <td>
                      <span className={`badge ${el.is_complete ? 'badge-complete' : 'badge-incomplete'}`}>
                        {el.is_complete ? '✓ Compleet' : '⚠ Incompleet'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Zones energy summary ──────────────────────────────────── */}
        {zones.some((z: Zone) => z.energy_label) && (
          <div className="section">
            <h2>Energielabels per Zone</h2>
            <table>
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>Verdieping</th>
                  <th>Oppervlakte (m²)</th>
                  <th>Energielabel</th>
                </tr>
              </thead>
              <tbody>
                {zones.filter((z: Zone) => z.energy_label).map((z: Zone) => (
                  <tr key={z.id}>
                    <td>{z.name}</td>
                    <td>{floorName(z.floor_level)}</td>
                    <td>{m2(z.gross_area_m2)}</td>
                    <td>
                      <span className={`badge label-${(z.energy_label ?? '').toLowerCase()}`}>
                        {z.energy_label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Footer ───────────────────────────────────────────────── */}
        <div style={{ borderTop: '0.5pt solid #ccc', paddingTop: '6pt', marginTop: '12pt', fontSize: '7.5pt', color: '#888' }}>
          <p>Gegenereerd door Scanergy · {org?.name ?? ''} · {new Date().toLocaleDateString('nl-NL')}</p>
          <p>{session.session_code} · Opname: {surveyDate} · Inspecteur: {session.inspector_name}</p>
        </div>

        <script dangerouslySetInnerHTML={{ __html: '' }} />
    </>
  );
}
