'use client';

import type { Zone } from '@/lib/types';

interface Props {
  zone: Zone;
  imageUrl: string;           // pre-signed URL generated server-side
  width?: number;             // display width in px, default 380
}

// Port of the mobile fitLines() projection:
// Normalises raw [0,1] polygon points to SVG coordinates inside the padded canvas.
function fitPoints(
  raw: Array<{ x: number; y: number }>,
  w: number,
  h: number,
): string {
  if (!raw || raw.length < 3) return '';
  const pad    = 10;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const xs = raw.map(p => p.x), ys = raw.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rX = maxX - minX || 1, rY = maxY - minY || 1;
  const scale = Math.min(innerW / rX, innerH / rY);
  const offX  = pad + (innerW - rX * scale) / 2;
  const offY  = pad + (innerH - rY * scale) / 2;
  return raw
    .map(p => `${(offX + (p.x - minX) * scale).toFixed(1)},${(offY + (p.y - minY) * scale).toFixed(1)}`)
    .join(' ');
}

export function FloorPlanViewer({ zone, imageUrl, width = 380 }: Props) {
  if (!zone.floor_plan_image_url || !imageUrl) return null;

  const h      = Math.round(width * (3 / 4));           // 4:3 aspect ratio
  const points = zone.floor_plan_points
    ? fitPoints(zone.floor_plan_points, width, h)
    : '';

  // Scale label: derive cell size from scale_m and canvas width
  let scaleLabel = '';
  if (zone.floor_plan_scale_m) {
    const CELL_PX = 20;
    const innerW  = width - 20;
    const cellM   = zone.floor_plan_scale_m / (innerW / CELL_PX);
    scaleLabel    = `Schaal: 1 cel ≈ ${cellM.toFixed(2)} m`;
  }

  return (
    <div className="relative rounded-lg overflow-hidden border border-gray-200 bg-gray-50"
         style={{ width, height: h }}>
      {/* Floor plan image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={`Floor plan ${zone.name}`}
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Polygon overlay */}
      {points && (
        <svg
          className="absolute inset-0"
          width={width}
          height={h}
          style={{ pointerEvents: 'none' }}
        >
          <polygon
            points={points}
            fill="rgba(30,58,95,0.12)"
            stroke="#1E3A5F"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </svg>
      )}

      {/* Scale label */}
      {scaleLabel && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-[10px] font-medium px-2 py-1">
          {scaleLabel}
        </div>
      )}
    </div>
  );
}
