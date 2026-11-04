/**
 * Tapwater pipe-segment capture (§7.1, migration 024 `tapwater_segments`).
 *
 * The DB stores structured JSONB — per-room arrays of metre segments, e.g.
 * {"badkamer":[4.77,2.39],"keuken":[0.2]} — replacing free-text sums. The
 * mobile form captures it as one line of text; these two functions are the
 * round-trip between that text and the JSONB shape.
 *
 * Text format: `room: len[, len…][; room: …]` — "badkamer: 4.77, 2.39; keuken: 0.2".
 * Decimals use a dot; a decimal comma would be ambiguous with the segment
 * separator and is treated as one.
 */

export type TapwaterSegments = Record<string, number[]>;

/** Parse the capture text; null when nothing valid was entered. */
export function parseTapwaterSegments(text: string): TapwaterSegments | null {
  const out: TapwaterSegments = {};
  for (const part of text.split(';')) {
    const [room, rest] = part.split(':');
    if (!room?.trim() || rest == null) continue;
    const lengths = rest
      .split(',')
      .map(s => Number(s.trim()))
      .filter(n => Number.isFinite(n) && n > 0);
    if (lengths.length) out[room.trim()] = lengths;
  }
  return Object.keys(out).length ? out : null;
}

/** Format stored JSONB back into the capture text. */
export function formatTapwaterSegments(segments: unknown): string {
  if (segments == null || typeof segments !== 'object' || Array.isArray(segments)) return '';
  return Object.entries(segments as Record<string, unknown>)
    .filter(([, v]) => Array.isArray(v))
    .map(([room, v]) => `${room}: ${(v as unknown[]).filter(n => typeof n === 'number').join(', ')}`)
    .join('; ');
}
