import { normalizePostcode, parsePdokResponse } from "../lib/addressLookup";

// Shape taken from a real PDOK Locatieserver response (Dam 1, Amsterdam).
const dam1 = {
  response: {
    numFound: 1,
    docs: [{
      woonplaatsnaam: "Amsterdam", weergavenaam: "Dam 1, 1012JS Amsterdam", gemeentenaam: "Amsterdam",
      postcode: "1012JS", provincienaam: "Noord-Holland", centroide_ll: "POINT(4.8937175 52.37329259)",
      nummeraanduiding_id: "0363200003761447", huisnummer: 1, straatnaam: "Dam",
    }],
  },
};

// A number with several units: 10, 10A and 10-bis.
const multi = {
  response: {
    docs: [
      { straatnaam: "Kerkstraat", huisnummer: 10, huisletter: "A", woonplaatsnaam: "Leiden", weergavenaam: "Kerkstraat 10A" },
      { straatnaam: "Kerkstraat", huisnummer: 10, huisnummertoevoeging: "bis", woonplaatsnaam: "Leiden", weergavenaam: "Kerkstraat 10-bis" },
    ],
  },
};

describe("normalizePostcode", () => {
  test("accepts any spacing and case, rejects non-Dutch codes", () => {
    expect(normalizePostcode("1012js")).toEqual({ query: "1012JS", display: "1012 JS" });
    expect(normalizePostcode(" 1012 JS ")).toEqual({ query: "1012JS", display: "1012 JS" });
    expect(normalizePostcode("0123AB")).toBeNull();   // Dutch postcodes never start with 0
    expect(normalizePostcode("1012J")).toBeNull();
    expect(normalizePostcode("")).toBeNull();
  });
});

describe("parsePdokResponse", () => {
  test("found: maps street, city, region, coordinates and BAG id", () => {
    const r = parsePdokResponse(dam1, "", "1012 JS");
    expect(r.status).toBe("found");
    if (r.status !== "found") return;
    expect(r.address).toMatchObject({
      street: "Dam", house_number: "1", house_number_addition: null, postal_code: "1012 JS",
      city: "Amsterdam", municipality: "Amsterdam", province: "Noord-Holland",
      bag_id: "0363200003761447",
    });
    expect(r.address.latitude).toBeCloseTo(52.3733, 3);
    expect(r.address.longitude).toBeCloseTo(4.8937, 3);
  });

  test("not found when the service returns nothing, or the addition doesn't exist", () => {
    expect(parsePdokResponse({ response: { docs: [] } }, "", "1012 JS").status).toBe("not_found");
    expect(parsePdokResponse(dam1, "B", "1012 JS").status).toBe("not_found");
    expect(parsePdokResponse(null, "", "1012 JS").status).toBe("not_found");
  });

  test("several units and no addition given: ask which one", () => {
    expect(parsePdokResponse(multi, "", "2311 AB")).toEqual({ status: "choose", additions: ["A", "bis"] });
  });

  test("addition matching ignores case, spaces and dashes", () => {
    const a = parsePdokResponse(multi, "a", "2311 AB");
    expect(a.status === "found" && a.address.house_number_addition).toBe("A");
    const bis = parsePdokResponse(multi, "-BIS", "2311 AB");
    expect(bis.status === "found" && bis.address.house_number_addition).toBe("bis");
  });
});
