import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase-server';
import type {
  Building, BuildingElement, BuildingFacadePhoto,
  Opening, Organisation, Zone,
} from '@/lib/types';
import { PrintButton } from '@/components/print/PrintButton';

interface Props { params: { id: string } }

// This route renders standalone print output but still lives under the app's
// single root layout (app/layout.tsx already emits <html><body>) — so the
// title goes through generateMetadata instead of a literal <title> tag, which
// would otherwise nest a second <html><head> inside the root <body> and break
// hydration (server/browser disagree on where <style> ends up).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const supabase = await createClient();
  const { data: building } = await (supabase.from('buildings') as any)
    .select('street, house_number, postal_code, city')
    .eq('id', params.id)
    .single();
  if (!building) return { title: 'Opname Rapport' };
  return { title: `Opname Rapport — ${building.street} ${building.house_number}, ${building.postal_code} ${building.city}` };
}

const DIRECTIONS: { key: BuildingFacadePhoto['direction']; label: string }[] = [
  { key: 'voor',   label: 'Voorgevel'    },
  { key: 'achter', label: 'Achtergevel'  },
  { key: 'links',  label: 'Linkergevel'  },
  { key: 'rechts', label: 'Rechtergevel' },
];

function m2(v: number | null | undefined): string {
  return v != null ? `${Number(v.toFixed(2))} m²` : '—';
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
function toCardinalShort(deg: number | null): string {
  if (deg == null) return '—';
  const d = ((deg % 360) + 360) % 360;
  return ['N','NE','E','SE','S','SW','W','NW'][Math.round(d / 45) % 8];
}

// Fit polygon points to SVG canvas (same projection as FloorPlanViewer)
function fitPointsSvg(raw: Array<{x:number;y:number}>, w: number, h: number): string {
  if (!raw || raw.length < 3) return '';
  const pad = 8;
  const xs = raw.map(p=>p.x), ys = raw.map(p=>p.y);
  const minX = Math.min(...xs), rX = (Math.max(...xs)-minX)||1;
  const minY = Math.min(...ys), rY = (Math.max(...ys)-minY)||1;
  const scale = Math.min((w-pad*2)/rX,(h-pad*2)/rY);
  const ox = pad+((w-pad*2)-rX*scale)/2;
  const oy = pad+((h-pad*2)-rY*scale)/2;
  return raw.map(p=>`${(ox+(p.x-minX)*scale).toFixed(1)},${(oy+(p.y-minY)*scale).toFixed(1)}`).join(' ');
}

export default async function BuildingPrintPage({ params }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return notFound();

  const [buildingRes, orgRes, sessionRes, facadeRes] = await Promise.all([
    (supabase.from('buildings') as any).select('*').eq('id', params.id).single(),
    (supabase.from('organisations') as any).select('*').single(),
    (supabase.from('session_summary') as any)
      .select('inspector_name, started_at')
      .eq('building_id', params.id)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single(),
    (supabase.from('building_facade_photos') as any)
      .select('*').eq('building_id', params.id).order('direction'),
  ]);

  const building: Building | null = buildingRes.data;
  if (!building) notFound();
  const org: Organisation | null = orgRes.data ?? null;
  const session = sessionRes.data ?? null;
  const facadePhotosRaw: BuildingFacadePhoto[] = facadeRes.data ?? [];

  const surveyDate = session?.started_at
    ? new Date(session.started_at).toLocaleDateString('nl-NL', { day:'2-digit', month:'2-digit', year:'numeric' })
    : '—';
  const address = `${building.street} ${building.house_number}, ${building.postal_code} ${building.city}`;

  // Zones
  const zonesRes = await (supabase.from('zones') as any)
    .select('*').eq('building_id', params.id).eq('is_active', true).order('floor_level');
  const zones: Zone[] = zonesRes.data ?? [];
  const zoneIds = zones.map((z:Zone) => z.id);

  let elements: BuildingElement[] = [];
  let openings: Opening[]         = [];

  if (zoneIds.length) {
    const [elRes, opRes] = await Promise.all([
      (supabase.from('building_elements') as any).select('*').in('zone_id', zoneIds).eq('is_active', true).order('element_type').order('sort_order'),
      (supabase.from('openings') as any).select('*').eq('is_active', true),
    ]);
    elements = elRes.data ?? [];
    const elIds = new Set(elements.map((e:BuildingElement) => e.id));
    openings = (opRes.data ?? []).filter((o:any) => elIds.has(o.element_id));
  }

  const openingsByEl: Record<string, Opening[]> = {};
  for (const o of openings) {
    const eid = (o as any).element_id;
    (openingsByEl[eid] ??= []).push(o);
  }

  const gevels       = elements.filter(e => e.element_type === 'gevel');
  const vloeren      = elements.filter(e => e.element_type === 'vloer');
  const daken        = elements.filter(e => e.element_type === 'dak');
  const installaties = elements.filter(e => e.element_type === 'installatie');
  const totalArea    = zones.reduce((s:number, z:Zone) => s+(z.gross_area_m2??0), 0);

  // Sign facade photo URLs
  const facadeByDir: Record<string, string | null> = {};
  await Promise.all(facadePhotosRaw.map(async p => {
    if (p.photo_url.startsWith('http')) { facadeByDir[p.direction] = p.photo_url; return; }
    const { data } = await supabase.storage.from('facade-photos').createSignedUrl(p.photo_url, 3600);
    facadeByDir[p.direction] = data?.signedUrl ?? null;
  }));

  const CANVAS_W = 280, CANVAS_H = 210;

  return (
    <>
        <style>{`
          *{box-sizing:border-box;margin:0;padding:0}
          body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#111;background:#fff}
          h1{font-size:18pt;margin-bottom:4pt;color:#3f8fa8;font-weight:400}
          h2{font-size:14pt;margin:16pt 0 8pt;color:#111;font-weight:400}
          h3{font-size:9.5pt;margin:10pt 0 4pt;color:#333}
          h4{font-size:9pt;margin:8pt 0 3pt;color:#333}
          table{width:100%;border-collapse:collapse;font-size:8.5pt;margin-bottom:8pt}
          th{background:#5b9db3;color:#111;padding:3pt 5pt;text-align:left;font-weight:700}
          td{padding:2.5pt 5pt;border-bottom:.5pt solid #ddd;vertical-align:top}
          tr:nth-child(even) td{background:#f7f8fb}
          .kv td:first-child{font-weight:700;width:160pt;background:#5b9db3;color:#111;border:.5pt solid #ccc}
          .kv td{border:.5pt solid #ccc}
          .instal-table th{background:#fbe4c9;color:#111}
          .instal-table .kv td:first-child{background:#fbe4c9}
          .section{margin-bottom:18pt}
          .page-break{page-break-before:always}
          .warn{color:#b45309}
          .fp-wrap{position:relative;display:inline-block;border:.5pt solid #ccc;border-radius:4pt;overflow:hidden}
          .fp-wrap img{display:block;width:${CANVAS_W}px;height:${CANVAS_H}px;object-fit:cover}
          .fp-wrap svg{position:absolute;top:0;left:0;pointer-events:none}
          .fp-label{background:rgba(0,0,0,.4);color:#fff;font-size:7pt;font-weight:600;padding:2pt 5pt;text-align:center}
          .photos-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8pt;margin-bottom:8pt}
          .photo-cell{text-align:center}
          .photo-cell img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:4pt;border:.5pt solid #ccc}
          .photo-cell .dir{font-size:7.5pt;font-weight:600;color:#3f8fa8;margin-top:3pt}
          .photo-placeholder{width:100%;aspect-ratio:4/3;background:#f3f4f6;border:.5pt dashed #ccc;border-radius:4pt;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:8pt}
          @page{size:A4;margin:15mm 18mm}
          @media print{.no-print{display:none}a{color:inherit;text-decoration:none}}
        `}</style>

        {/* Print button */}
        <PrintButton hint="Browser Print → Save as PDF" />

        {/* ── Section 1 — Header ───────────────────────────────────────── */}
        <div className="section">
          <h1>Opname Rapport</h1>
          <p style={{fontSize:'8pt',color:'#666',marginBottom:'8pt'}}>Energetische opname conform NTA 8800 / NEN 2580</p>
          <table className="kv" style={{maxWidth:'360pt'}}>
            <tbody>
              <tr><td>Locatie</td><td>{address}</td></tr>
              <tr><td>Datum opname</td><td>{surveyDate}</td></tr>
              <tr><td>Opname gedaan door</td><td>{fmt(session?.inspector_name)}</td></tr>
              <tr><td>Bedrijf</td><td>{fmt(org?.name)}</td></tr>
              {(building as any).construction_year && <tr><td>Bouwjaar</td><td>{(building as any).construction_year}</td></tr>}
              {(building as any).building_type     && <tr><td>Gebouwtype</td><td>{(building as any).building_type}</td></tr>}
              <tr><td>Referentie</td><td style={{fontFamily:'monospace'}}>{building.reference_code}</td></tr>
            </tbody>
          </table>
        </div>

        {/* ── Section 2 — Gevel Foto's ────────────────────────────────── */}
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

        {/* ── Section 3 — Gebruiksoppervlakte ─────────────────────────── */}
        <div className="section">
          <h2>3. Gebruiksoppervlakte</h2>
          <table>
            <thead><tr><th>Verdieping</th><th>Zone</th><th style={{textAlign:'right'}}>m²</th></tr></thead>
            <tbody>
              {zones.map((z:Zone) => (
                <tr key={z.id}>
                  <td>{floorName(z.floor_level)}</td>
                  <td>{z.name}</td>
                  <td style={{textAlign:'right'}}>{m2(z.gross_area_m2)}</td>
                </tr>
              ))}
              <tr><td colSpan={2} style={{fontWeight:700}}>Totaal</td><td style={{textAlign:'right',fontWeight:700}}>{m2(totalArea)}</td></tr>
            </tbody>
          </table>
        </div>

        {/* ── Section 4 — Plattegronden ────────────────────────────────── */}
        {zones.some((z:Zone) => z.floor_plan_image_url) && (
          <div className="section">
            <h2>4. Overzicht Plattegronden</h2>
            <div style={{display:'flex',flexWrap:'wrap',gap:'12pt'}}>
              {zones.filter((z:Zone) => z.floor_plan_image_url).map((z:Zone) => {
                const pts = z.floor_plan_points ? fitPointsSvg(z.floor_plan_points, CANVAS_W, CANVAS_H) : '';
                const scaleLabel = z.floor_plan_scale_m
                  ? `Schaal: 1 cel ≈ ${(z.floor_plan_scale_m/((CANVAS_W-16)/20)).toFixed(2)} m`
                  : '';
                return (
                  <div key={z.id} style={{display:'flex',flexDirection:'column',gap:'4pt'}}>
                    <div style={{fontSize:'8pt',fontWeight:700,color:'#1e3a5f'}}>{z.name}</div>
                    <div className="fp-wrap">
                      <img src={z.floor_plan_image_url!} alt={`Plattegrond ${z.name}`} />
                      {pts && (
                        <svg width={CANVAS_W} height={CANVAS_H}>
                          <polygon points={pts} fill="rgba(30,58,95,0.12)" stroke="#1e3a5f" strokeWidth={1.5} strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    {scaleLabel && <div className="fp-label">{scaleLabel}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Section 5a — Gevels overzicht ───────────────────────────── */}
        {gevels.length > 0 && (
          <div className="section page-break">
            <h2>5a. Gevels — Overzichtstabel</h2>
            <table>
              <thead><tr><th>ID</th><th>Naam</th><th>Positie</th><th>Oriëntatie</th><th>H × B (m)</th><th style={{textAlign:'right'}}>Opp (m²)</th><th>Grenzt aan</th><th>Rc</th><th>U</th></tr></thead>
              <tbody>
                {gevels.map(el => (
                  <tr key={el.id}>
                    <td style={{fontFamily:'monospace',fontSize:'7pt'}}>{el.id.slice(0,8)}</td>
                    <td>{el.name}</td>
                    <td>{fmt(el.construction_type)}</td>
                    <td>{toCardinalShort(el.orientation_deg)}</td>
                    <td>{el.height_mm!=null&&el.length_mm!=null?`${(el.height_mm/1000).toFixed(2)}×${(el.length_mm/1000).toFixed(2)}`:'—'}</td>
                    <td style={{textAlign:'right'}}>{m2(el.area_m2)}</td>
                    <td>{fmt(el.description)}</td>
                    <td>{fmt(el.rc_value)}</td>
                    <td>{fmt(el.u_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Section 5b — Vloeren ──────────────────────────────────────── */}
        {vloeren.length > 0 && (
          <div className="section">
            <h2>5b. Vloeren — Overzichtstabel</h2>
            <table>
              <thead><tr><th>Naam</th><th>Grenzt aan</th><th>Vloerisolatie</th><th>Bodemisolatie</th><th style={{textAlign:'right'}}>Opp (m²)</th><th>Rc</th></tr></thead>
              <tbody>
                {vloeren.map(el => (
                  <tr key={el.id}>
                    <td>{el.name}</td>
                    <td>{fmt(el.description)}</td>
                    <td>{el.insulation_type?'Ja':<span className="warn">Nee</span>}</td>
                    <td>{(el as any).bodemisolatie?'Ja':<span className="warn">Nee</span>}</td>
                    <td style={{textAlign:'right'}}>{m2(el.area_m2)}</td>
                    <td>{fmt(el.rc_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Section 5c — Daken ────────────────────────────────────────── */}
        {daken.length > 0 && (
          <div className="section">
            <h2>5c. Daken — Overzichtstabel</h2>
            <table>
              <thead><tr><th>Naam</th><th>Type</th><th>Hoek</th><th>Oriëntatie</th><th>Nokhoogte</th><th style={{textAlign:'right'}}>Netto (m²)</th><th>Rc</th></tr></thead>
              <tbody>
                {daken.map(el => (
                  <tr key={el.id}>
                    <td>{el.name}</td>
                    <td>{el.construction_type ?? (el.tilt_deg!=null&&el.tilt_deg<5?'PlatDak':'HellendDak')}</td>
                    <td>{el.tilt_deg!=null?`${el.tilt_deg}°`:'—'}</td>
                    <td>{toCardinalShort(el.orientation_deg)}</td>
                    <td>{(el as any).nokhoogte_m!=null?`${(el as any).nokhoogte_m} m`:'—'}</td>
                    <td style={{textAlign:'right'}}>{m2(el.area_m2)}</td>
                    <td>{fmt(el.rc_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Section 5d — Detail Gevels ───────────────────────────────── */}
        {gevels.length > 0 && (
          <div className="section">
            <h2>5d. Gedetailleerde Uitwerking — Gevels</h2>
            {gevels.map(el => {
              const elOpenings = openingsByEl[el.id] ?? [];
              return (
                <div key={el.id} style={{marginBottom:'14pt',border:'.5pt solid #ccc',padding:'8pt'}}>
                  <h3>{el.name}</h3>
                  <table className="kv" style={{maxWidth:'340pt',marginBottom:'6pt'}}>
                    <tbody>
                      <tr><td>Positie</td><td>{fmt(el.construction_type)}</td></tr>
                      <tr><td>Oriëntatie</td><td>{toCardinalShort(el.orientation_deg)}</td></tr>
                      <tr><td>Afmetingen (H×B)</td><td>{el.height_mm!=null&&el.length_mm!=null?`${(el.height_mm/1000).toFixed(2)} × ${(el.length_mm/1000).toFixed(2)} m`:'—'}</td></tr>
                      <tr><td>Oppervlakte</td><td>{m2(el.area_m2)}</td></tr>
                      <tr><td>Grenzend aan</td><td>{fmt(el.description)}</td></tr>
                      {(el as any).perimeter_m!=null&&<tr><td>Perimeter</td><td>{(el as any).perimeter_m} m</td></tr>}
                      <tr><td>Rc-waarde</td><td>{el.rc_value!=null?`${el.rc_value} m²K/W`:'—'}</td></tr>
                      <tr><td>U-waarde</td><td>{el.u_value!=null?`${el.u_value} W/m²K`:'—'}</td></tr>
                      {el.insulation_type&&<tr><td>Isolatietype</td><td>{el.insulation_type}</td></tr>}
                    </tbody>
                  </table>
                  {elOpenings.length > 0 && (
                    <>
                      <h4>Transparante Delen</h4>
                      <table>
                        <thead><tr><th>Type</th><th>H × B</th><th style={{textAlign:'right'}}>Opp</th><th>Kozijn</th><th>Beglazing</th><th>TO</th><th>Zonwering</th><th>U</th></tr></thead>
                        <tbody>
                          {elOpenings.map(o => {
                            const area = o.area_m2 ?? (o.height_mm!=null&&o.width_mm!=null?Number(((o.height_mm/1000)*(o.width_mm/1000)).toFixed(2)):null);
                            const isEnkel = (o.glazing_type??'').toLowerCase().includes('enkel');
                            return (
                              <tr key={o.id}>
                                <td>{fmt(o.opening_type)}</td>
                                <td>{o.height_mm!=null&&o.width_mm!=null?`${(o.height_mm/1000).toFixed(2)}×${(o.width_mm/1000).toFixed(2)}`:'—'}</td>
                                <td style={{textAlign:'right'}}>{m2(area)}</td>
                                <td>{fmt(o.frame_type)}</td>
                                <td style={{color:isEnkel?'#b45309':'inherit',fontWeight:isEnkel?700:400}}>{fmt(o.glazing_type)}</td>
                                <td>{(o as any).thermisch_onderbroken?'Ja':'Nee'}</td>
                                <td>{o.has_shading?fmt(o.shading_type):'Geen'}</td>
                                <td>{fmt(o.u_value_total)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Section 6 — Installaties ─────────────────────────────────── */}
        {installaties.length > 0 && (
          <div className="section">
            <h2>6. Bijbehorende Installaties</h2>
            <table className="instal-table">
              <thead><tr><th>Type</th><th>Merk</th><th>Model</th><th>CV klasse</th><th>Brandstof</th><th>Vermogen</th><th>Rendement</th><th>Locatie</th></tr></thead>
              <tbody>
                {installaties.map(el => (
                  <tr key={el.id}>
                    <td>{fmt(el.installation_type)}</td>
                    <td>{fmt((el as any).brand)}</td>
                    <td>{fmt((el as any).model_nr)}</td>
                    <td>{fmt((el as any).cv_klasse)}</td>
                    <td>{fmt(el.fuel_type)}</td>
                    <td>{el.capacity_kw!=null?`${el.capacity_kw} kW`:'—'}</td>
                    <td>{el.efficiency!=null?`${(Number(el.efficiency)*100).toFixed(0)}%`:'—'}</td>
                    <td>{fmt(el.description)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div style={{borderTop:'.5pt solid #ccc',paddingTop:'6pt',marginTop:'12pt',fontSize:'7.5pt',color:'#888'}}>
          <p>Gegenereerd door Scanergy · {org?.name ?? ''} · {new Date().toLocaleDateString('nl-NL')}</p>
          <p>Gebouw: {address} · Opname: {surveyDate} · Inspecteur: {fmt(session?.inspector_name)}</p>
        </div>
    </>
  );
}
