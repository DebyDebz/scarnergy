import { parseTapwaterSegments, formatTapwaterSegments } from '../lib/tapwater';

describe('tapwater segments (§7.1) text ⇄ JSONB round-trip', () => {
  it('parses rooms with multiple segments', () => {
    expect(parseTapwaterSegments('badkamer: 4.77, 2.39; keuken: 0.2')).toEqual({
      badkamer: [4.77, 2.39],
      keuken: [0.2],
    });
  });

  it('tolerates stray whitespace, empty parts and trailing separators', () => {
    expect(parseTapwaterSegments(' badkamer : 4.77 ;; keuken: 0.2, ')).toEqual({
      badkamer: [4.77],
      keuken: [0.2],
    });
  });

  it('treats a decimal comma as a segment separator (dots-only format)', () => {
    expect(parseTapwaterSegments('badkamer: 4,77')).toEqual({ badkamer: [4, 77] });
  });

  it('returns null when nothing valid was entered', () => {
    expect(parseTapwaterSegments('')).toBeNull();
    expect(parseTapwaterSegments('just some notes')).toBeNull();
    expect(parseTapwaterSegments('badkamer: abc, -1')).toBeNull();
  });

  it('formats stored JSONB back to the capture text', () => {
    expect(formatTapwaterSegments({ badkamer: [4.77, 2.39], keuken: [0.2] }))
      .toBe('badkamer: 4.77, 2.39; keuken: 0.2');
    expect(formatTapwaterSegments(null)).toBe('');
    expect(formatTapwaterSegments('not an object')).toBe('');
  });

  it('round-trips', () => {
    const text = 'badkamer: 4.77, 2.39; keuken: 0.2';
    expect(formatTapwaterSegments(parseTapwaterSegments(text))).toBe(text);
  });
});
