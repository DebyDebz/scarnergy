'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Upload, ChevronRight, AlertTriangle, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import type { Zone } from '@/lib/types';

const CANVAS_W = 600;
const CANVAS_H = 480;
const CLOSE_R  = 18;   // px — tap radius to close polygon
const PRIMARY  = '#1E3A5F';

interface Point { x: number; y: number }

interface Props {
  zone: Zone;
  buildingId: string;
  onClose: () => void;
  onSaved: (updated: Zone) => void;
}

type Step = 1 | 2 | 3;

// ── Geometry helpers ────────────────────────────────────────────────────────

function normalize(pts: Point[], w: number, h: number): Point[] {
  return pts.map(p => ({ x: p.x / w, y: p.y / h }));
}

function fitToCanvas(
  pts: Point[],
  cw: number,
  ch: number,
  pad = 24,
): Point[] {
  if (pts.length < 2) return pts;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rX = maxX - minX || 1, rY = maxY - minY || 1;
  const inner = Math.min(cw, ch) - pad * 2;
  const scale = Math.min(inner / rX, inner / rY);
  const offX  = pad + (cw - pad * 2 - rX * scale) / 2;
  const offY  = pad + (ch - pad * 2 - rY * scale) / 2;
  return pts.map(p => ({
    x: offX + (p.x - minX) * scale,
    y: offY + (p.y - minY) * scale,
  }));
}

function gridLines(
  normalPts: Point[],
  cw: number,
  ch: number,
  scaleM: number,
  cellPx = 20,
) {
  const INNER_W = cw - 24 * 2;
  const cellM   = scaleM / (INNER_W / cellPx);
  return { cellM };
}

// ── Component ────────────────────────────────────────────────────────────────

export function FloorPlanUploadModal({ zone, buildingId, onClose, onSaved }: Props) {
  const [step, setStep]           = useState<Step>(zone.floor_plan_image_url ? 2 : 1);
  const [imgFile, setImgFile]     = useState<File | null>(null);
  const [imgUrl, setImgUrl]       = useState<string | null>(zone.floor_plan_image_url ?? null);
  const [imgSize, setImgSize]     = useState<{ w: number; h: number } | null>(null);
  const [points, setPoints]       = useState<Point[]>(() =>
    zone.floor_plan_points
      ? zone.floor_plan_points.map(p => ({ x: p.x * CANVAS_W, y: p.y * CANVAS_H }))
      : []
  );
  const [closed, setClosed]       = useState(zone.floor_plan_points != null && (zone.floor_plan_points?.length ?? 0) >= 3);
  const [scaleInput, setScaleInput] = useState(zone.floor_plan_scale_m?.toString() ?? '');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [dragOver, setDragOver]   = useState(false);

  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scaleVal    = parseFloat(scaleInput) || 0;
  const scaleWarn   = scaleInput !== '' && (scaleVal < 0.5 || scaleVal > 200);
  const scaleValid  = scaleVal >= 0.5 && scaleVal <= 200;

  // ── Draw canvas overlay ──────────────────────────────────────────────────
  const drawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    if (points.length < 1) return;

    // Polygon fill (translucent)
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    if (closed) {
      ctx.closePath();
      ctx.fillStyle = 'rgba(30,58,95,0.15)';
      ctx.fill();
    }

    // Edges
    ctx.strokeStyle = PRIMARY;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    if (closed) ctx.closePath();
    ctx.stroke();

    // Guide dash from last → first (when open)
    if (!closed && points.length >= 2) {
      const last  = points[points.length - 1];
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = '#93C5FD';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(points[0].x, points[0].y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Vertices
    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === 0 ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#2563EB' : PRIMARY;
      ctx.fill();
    });
  }, [points, closed]);

  useEffect(() => { drawOverlay(); }, [drawOverlay]);

  // ── Step 1: file selection ───────────────────────────────────────────────
  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload a PNG, JPG, or JPEG image.');
      return;
    }
    setError(null);
    setImgFile(file);
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    const img = new Image();
    img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
    setPoints([]);
    setClosed(false);
    setStep(2);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // ── Step 2: polygon drawing ──────────────────────────────────────────────
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (closed) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (points.length >= 3) {
      const dx = x - points[0].x, dy = y - points[0].y;
      if (Math.hypot(dx, dy) < CLOSE_R) {
        setClosed(true);
        return;
      }
    }
    setPoints(prev => [...prev, { x, y }]);
  };

  const undoPoint = () => {
    if (closed) { setClosed(false); return; }
    setPoints(prev => prev.slice(0, -1));
  };

  const resetPoints = () => { setPoints([]); setClosed(false); };

  const closeShape = () => { if (points.length >= 3) setClosed(true); };

  // ── Step 3: save ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!scaleValid) return;
    setSaving(true);
    setError(null);

    try {
      const supabase = createClient();
      let finalUrl = zone.floor_plan_image_url ?? null;

      // Upload image if a new file was selected
      if (imgFile) {
        const ext  = imgFile.name.split('.').pop() ?? 'jpg';
        const path = `${buildingId}/${zone.id}/floor_plan.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('floor-plans')
          .upload(path, imgFile, { upsert: true });
        if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

        const { data: urlData } = supabase.storage
          .from('floor-plans')
          .getPublicUrl(path);
        finalUrl = urlData.publicUrl;
      }

      const normalPts = normalize(points, CANVAS_W, CANVAS_H);

      const { data, error: dbErr } = await (supabase.from('zones') as any)
        .update({
          floor_plan_image_url: finalUrl,
          floor_plan_points:    normalPts as any,
          floor_plan_scale_m:   scaleVal,
        })
        .eq('id', zone.id)
        .select()
        .single();

      if (dbErr) throw new Error(dbErr.message);

      onSaved(data as unknown as Zone);
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong.');
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const CELL_PX  = 20;
  const INNER_W  = CANVAS_W - 48;
  const cellM    = scaleValid ? scaleVal / (INNER_W / CELL_PX) : null;
  const gridCols = Math.ceil(CANVAS_W / CELL_PX) + 1;
  const gridRows = Math.ceil(CANVAS_H / CELL_PX) + 1;

  // Fit existing polygon to canvas for step-3 grid preview
  const fittedPts = closed
    ? fitToCanvas(points, CANVAS_W, CANVAS_H)
    : [];

  const stepLabel = step === 1 ? 'Upload image'
    : step === 2 ? 'Trace boundary'
    : 'Set scale';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[95vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900">Floor Plan — {zone.name}</h2>
            <p className="text-xs text-gray-400 mt-0.5">Step {step} of 3 — {stepLabel}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1 px-6 pt-3">
          {([1, 2, 3] as Step[]).map(s => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${s <= step ? 'bg-[#1E3A5F]' : 'bg-gray-200'}`} />
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── Step 1: Upload ── */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">Upload a floor plan image (PNG or JPG) for this zone. Inspectors will use it as a reference on mobile.</p>
              <div
                className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-10 h-10 text-gray-400" />
                <p className="text-sm text-gray-500 text-center">
                  Drag &amp; drop a floor plan image here, or <span className="text-blue-600 underline">browse</span>
                </p>
                <p className="text-xs text-gray-400">PNG, JPG, JPEG</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{error}</p>}
            </div>
          )}

          {/* ── Step 2: Trace boundary ── */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Click on the image to place polygon points tracing the zone boundary.
                Click the <span className="font-medium text-blue-600">first point</span> (blue dot) to close the shape.
              </p>

              <div className="relative rounded-xl overflow-hidden border border-gray-200 select-none"
                style={{ width: CANVAS_W, height: CANVAS_H, maxWidth: '100%' }}>
                {/* Floor plan image */}
                {imgUrl && (
                  <img
                    src={imgUrl}
                    alt="floor plan"
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                    style={{ background: '#f9fafb' }}
                  />
                )}
                {/* SVG canvas for clicks */}
                <canvas
                  ref={canvasRef}
                  width={CANVAS_W}
                  height={CANVAS_H}
                  className="absolute inset-0 cursor-crosshair"
                  style={{ background: imgUrl ? 'transparent' : '#f9fafb' }}
                  onClick={handleCanvasClick}
                />
                {/* Hint overlay */}
                {points.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <p className="text-sm text-gray-400 bg-white/80 px-3 py-1.5 rounded-lg">
                      Click to place the first corner
                    </p>
                  </div>
                )}
                {closed && (
                  <div className="absolute top-2 right-2 bg-emerald-500 text-white text-xs font-semibold px-2 py-1 rounded-full flex items-center gap-1 pointer-events-none">
                    <Check className="w-3 h-3" /> Shape closed
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={undoPoint} disabled={points.length === 0}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40">
                  ↩ Undo
                </button>
                <button onClick={resetPoints} disabled={points.length === 0}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40">
                  ✕ Reset
                </button>
                {!closed && points.length >= 3 && (
                  <button onClick={closeShape}
                    className="px-3 py-1.5 text-xs rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50">
                    ⬡ Close shape
                  </button>
                )}
                <span className="text-xs text-gray-400 ml-auto">{points.length} point{points.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          )}

          {/* ── Step 3: Set scale + grid preview ── */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Enter the real-world width of this zone so the grid cells represent accurate measurements.
              </p>

              {/* Scale input */}
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-700 font-medium w-40">Zone width (metres)</label>
                <input
                  type="number"
                  min="0.5"
                  max="200"
                  step="0.1"
                  value={scaleInput}
                  onChange={e => setScaleInput(e.target.value)}
                  className={`w-28 border rounded-lg px-3 py-2 text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-[#1E3A5F] ${scaleWarn ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`}
                  placeholder="e.g. 10"
                />
                <span className="text-sm text-gray-500">m</span>
                {cellM && (
                  <span className="text-xs text-gray-400">
                    ≈ {cellM.toFixed(2)} m / cell
                  </span>
                )}
              </div>
              {scaleWarn && (
                <p className="text-xs text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Value seems outside normal range (0.5–200 m). Please verify.
                </p>
              )}

              {/* Grid preview */}
              <div
                className="relative rounded-xl overflow-hidden border border-gray-200"
                style={{ width: CANVAS_W, height: CANVAS_H, maxWidth: '100%' }}
              >
                {/* Image background */}
                {imgUrl && (
                  <img
                    src={imgUrl}
                    alt="floor plan"
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none opacity-60"
                    style={{ background: '#f9fafb' }}
                  />
                )}

                {/* Grid lines */}
                {Array.from({ length: gridCols }).map((_, i) => (
                  <div key={`v${i}`} className="absolute top-0 bottom-0 w-px bg-gray-200/80"
                    style={{ left: i * CELL_PX }} />
                ))}
                {Array.from({ length: gridRows }).map((_, i) => (
                  <div key={`h${i}`} className="absolute left-0 right-0 h-px bg-gray-200/80"
                    style={{ top: i * CELL_PX }} />
                ))}

                {/* Polygon outline */}
                {fittedPts.length >= 3 && (
                  <svg className="absolute inset-0 pointer-events-none" width={CANVAS_W} height={CANVAS_H}>
                    <polygon
                      points={fittedPts.map(p => `${p.x},${p.y}`).join(' ')}
                      fill="rgba(30,58,95,0.1)"
                      stroke={PRIMARY}
                      strokeWidth={2}
                    />
                  </svg>
                )}

                {/* Scale labels */}
                {cellM && Array.from({ length: Math.floor(INNER_W / CELL_PX) + 1 }).map((_, i) => (
                  <span key={i} className="absolute text-[9px] text-gray-400"
                    style={{ left: i * CELL_PX + 2, bottom: 2 }}>
                    {(i * cellM).toFixed(1)}
                  </span>
                ))}
              </div>

              {error && (
                <p className="text-xs text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />{error}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
            Cancel
          </button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                onClick={() => setStep(s => (s - 1) as Step)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
              >
                ← Back
              </button>
            )}
            {step < 3 && (
              <button
                onClick={() => setStep(s => (s + 1) as Step)}
                disabled={
                  (step === 1 && !imgUrl) ||
                  (step === 2 && !closed)
                }
                className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium rounded-lg bg-[#1E3A5F] text-white hover:bg-[#16304f] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            )}
            {step === 3 && (
              <button
                onClick={handleSave}
                disabled={saving || !scaleValid}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium rounded-lg bg-[#1E3A5F] text-white hover:bg-[#16304f] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : <><Check className="w-4 h-4" /> Save floor plan</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
