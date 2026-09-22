/**
 * saveOpenings writes the same three-table shape for both capture paths
 * (LiDAR and AR). Only the PostgREST edge is faked; the row construction is real.
 */

interface Insert { table: string; rows: any[] }
const inserts: Insert[] = [];
let nextElementId = 1;

jest.mock("../lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      insert: (payload: any) => {
        const rows = Array.isArray(payload) ? payload : [payload];
        inserts.push({ table, rows });
        const chain = {
          select: () => ({ single: async () => ({ data: { id: `el-${nextElementId++}` }, error: null }) }),
        };
        // Non-element inserts are awaited directly and resolve to { error: null }.
        return Object.assign(Promise.resolve({ error: null }), chain);
      },
    }),
  },
}));

import { saveOpenings, OPENING_TYPE_LABEL } from "../lib/saveOpenings";

const ctx = { sessionId: "s1", zoneId: "z1", orgId: "org", inspectorId: "insp", source: "AR" as const };

beforeEach(() => { inserts.length = 0; nextElementId = 1; });

test("writes element + opening + two measurements per item, labelled by source", async () => {
  const saved = await saveOpenings(
    [{ type: "window", widthMm: 1200, heightMm: 900 }, { type: "door", widthMm: 880, heightMm: 2100 }],
    ctx,
  );
  expect(saved).toBe(2);
  expect(inserts.map(i => i.table)).toEqual([
    "building_elements", "openings", "measurements",
    "building_elements", "openings", "measurements",
  ]);

  const [el, op, meas] = inserts;
  // org_id is NOT NULL and RLS-checked on building_elements — omitting it was the
  // "Save failed" seen on device in both scan flows.
  expect(el.rows[0]).toMatchObject({
    org_id: "org", zone_id: "z1", element_type: "transparant_deel", name: `${OPENING_TYPE_LABEL.window} (AR)`,
    width_mm: 1200, height_mm: 900, is_complete: true,
  });
  expect(op.rows[0]).toMatchObject({ org_id: "org", element_id: "el-1", opening_type: "window", width_mm: 1200, height_mm: 900 });
  expect(meas.rows).toHaveLength(2);
  expect(meas.rows.map((r: any) => [r.measurement_type, r.value_mm])).toEqual([["width", 1200], ["height", 900]]);
  for (const r of meas.rows) {
    expect(r).toMatchObject({ session_id: "s1", org_id: "org", inspector_id: "insp", element_id: "el-1", unit: "mm", ingestion_path: "mobile", device_id: null });
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
  }
  expect(inserts[3].rows[0].name).toBe("Door (AR)");
  expect(inserts[4].rows[0].element_id).toBe("el-2");
});

test("LiDAR source keeps the historical label", async () => {
  await saveOpenings([{ type: "door", widthMm: 1, heightMm: 2 }], { ...ctx, source: "LiDAR" });
  expect(inserts[0].rows[0].name).toBe("Door (LiDAR)");
});

test("saves nothing for an empty list", async () => {
  expect(await saveOpenings([], ctx)).toBe(0);
  expect(inserts).toHaveLength(0);
});
