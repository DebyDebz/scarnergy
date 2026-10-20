// Dutch address lookup for "Add building": postcode + house number (+ optional
// letter/addition) → the official address, via PDOK Locatieserver — the
// government's free, keyless address service over BAG data. Same check as the
// client's current tool ("check postcode and house number").

export const PDOK_SEARCH =
  "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free";

export interface LookedUpAddress {
  street: string;
  house_number: string;
  house_number_addition: string | null;
  postal_code: string;        // display form "1234 AB"
  city: string;
  municipality: string | null;
  province: string | null;
  latitude: number | null;
  longitude: number | null;
  bag_id: string | null;      // BAG nummeraanduiding id
  label: string;              // e.g. "Dam 1, 1012JS Amsterdam"
}

export type AddressResult =
  | { status: "found"; address: LookedUpAddress }
  | { status: "not_found" }
  | { status: "choose"; additions: string[] };   // several units at that number

/** "1012js" / "1012 JS" → { query: "1012JS", display: "1012 JS" }, or null if not a Dutch postcode. */
export function normalizePostcode(input: string): { query: string; display: string } | null {
  const compact = input.replace(/\s+/g, "").toUpperCase();
  if (!/^[1-9][0-9]{3}[A-Z]{2}$/.test(compact)) return null;
  return { query: compact, display: `${compact.slice(0, 4)} ${compact.slice(4)}` };
}

function additionOf(doc: Record<string, unknown>): string {
  const letter = typeof doc.huisletter === "string" ? doc.huisletter : "";
  const toev = typeof doc.huisnummertoevoeging === "string" ? doc.huisnummertoevoeging : "";
  return `${letter}${letter && toev ? "-" : ""}${toev}`;
}

const norm = (s: string) => s.replace(/[\s-]+/g, "").toUpperCase();

function parsePoint(wkt: unknown): { lat: number; lon: number } | null {
  if (typeof wkt !== "string") return null;
  const m = /POINT\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/.exec(wkt);
  return m ? { lon: Number(m[1]), lat: Number(m[2]) } : null;
}

/**
 * Picks the address matching `addition` from a PDOK response.
 * No addition given: the unit without one, or "choose" if every unit has one.
 */
export function parsePdokResponse(json: unknown, addition: string, postcodeDisplay: string): AddressResult {
  const docs = ((json as { response?: { docs?: Record<string, unknown>[] } })?.response?.docs) ?? [];
  if (docs.length === 0) return { status: "not_found" };

  const wanted = norm(addition);
  const match = docs.find(d => norm(additionOf(d)) === wanted);
  if (!match) {
    const additions = docs.map(additionOf).filter(Boolean);
    return wanted === "" && additions.length > 0
      ? { status: "choose", additions: Array.from(new Set(additions)).sort() }
      : { status: "not_found" };
  }

  const pt = parsePoint(match.centroide_ll);
  const add = additionOf(match);
  return {
    status: "found",
    address: {
      street: String(match.straatnaam ?? ""),
      house_number: String(match.huisnummer ?? ""),
      house_number_addition: add || null,
      postal_code: postcodeDisplay,
      city: String(match.woonplaatsnaam ?? ""),
      municipality: typeof match.gemeentenaam === "string" ? match.gemeentenaam : null,
      province: typeof match.provincienaam === "string" ? match.provincienaam : null,
      latitude: pt?.lat ?? null,
      longitude: pt?.lon ?? null,
      bag_id: typeof match.nummeraanduiding_id === "string" ? match.nummeraanduiding_id : null,
      label: String(match.weergavenaam ?? ""),
    },
  };
}

/** Looks the address up online. Throws on network/service errors (caller offers manual entry). */
export async function lookupAddress(postcode: string, houseNumber: string, addition = ""): Promise<AddressResult> {
  const pc = normalizePostcode(postcode);
  const nr = houseNumber.trim();
  if (!pc || !/^\d{1,5}$/.test(nr)) return { status: "not_found" };
  const qs = new URLSearchParams({
    q: `postcode:${pc.query} AND huisnummer:${nr}`,
    fq: "type:adres",
    rows: "20",
    fl: "weergavenaam,straatnaam,huisnummer,huisletter,huisnummertoevoeging,postcode,woonplaatsnaam,gemeentenaam,provincienaam,centroide_ll,nummeraanduiding_id",
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${PDOK_SEARCH}?${qs.toString()}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Address service ${res.status}`);
    return parsePdokResponse(await res.json(), addition, pc.display);
  } finally {
    clearTimeout(timer);
  }
}
