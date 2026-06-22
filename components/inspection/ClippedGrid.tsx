import { useId } from 'react';
import Svg, { Defs, ClipPath, Polygon, Line, G } from 'react-native-svg';
import type { Pt } from '../../lib/floorplanGeometry';

/**
 * Grid overlay whose cells are CLIPPED to the floor-plan footprint polygon, so
 * the grid takes the exact shape of the outline instead of filling the canvas.
 * The outline itself is stroked on top. When no usable polygon is supplied
 * (< 3 points) it falls back to a full-canvas grid + no outline, matching the
 * previous behaviour so nothing regresses for not-yet-traced zones.
 *
 * Pure presentational SVG — the caller supplies the polygon already projected
 * into canvas-space pixels (via projectPointsOnImage / fitPointsToInner).
 */

interface Props {
  /** Square canvas size in px. */
  size: number;
  /** Grid cell size in px. */
  cellPx: number;
  /** Footprint polygon in canvas-space px. < 3 points → full grid, no clip. */
  points: Pt[];
  gridColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  outlineOpacity?: number;
  /** Stroke the footprint outline on top of the grid (default true). */
  showOutline?: boolean;
}

export function ClippedGrid({
  size,
  cellPx,
  points,
  gridColor = 'rgba(229,231,235,0.7)',
  outlineColor = '#1E3A5F',
  outlineWidth = 2,
  outlineOpacity = 0.85,
  showOutline = true,
}: Props) {
  const rawId = useId();
  // SVG ids must be valid NCNames; useId() emits ':' which is illegal in url(#…).
  const clipId = `fpclip-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const hasPolygon = points.length >= 3;
  const polyStr = hasPolygon ? points.map(p => `${p.x},${p.y}`).join(' ') : '';

  const nLines = Math.ceil(size / cellPx) + 1;
  const gridLines = (
    <G>
      {Array.from({ length: nLines }).map((_, i) => (
        <Line key={`v${i}`} x1={i * cellPx} y1={0} x2={i * cellPx} y2={size} stroke={gridColor} strokeWidth={1} />
      ))}
      {Array.from({ length: nLines }).map((_, i) => (
        <Line key={`h${i}`} x1={0} y1={i * cellPx} x2={size} y2={i * cellPx} stroke={gridColor} strokeWidth={1} />
      ))}
    </G>
  );

  return (
    <Svg
      width={size}
      height={size}
      style={{ position: 'absolute', top: 0, left: 0 }}
      pointerEvents="none"
    >
      {hasPolygon ? (
        <>
          <Defs>
            <ClipPath id={clipId}>
              <Polygon points={polyStr} />
            </ClipPath>
          </Defs>
          <G clipPath={`url(#${clipId})`}>{gridLines}</G>
          {showOutline && (
            <Polygon
              points={polyStr}
              fill="none"
              stroke={outlineColor}
              strokeWidth={outlineWidth}
              strokeOpacity={outlineOpacity}
              strokeLinejoin="round"
            />
          )}
        </>
      ) : (
        gridLines
      )}
    </Svg>
  );
}
