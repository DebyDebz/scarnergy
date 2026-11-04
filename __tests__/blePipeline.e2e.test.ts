/**
 * End-to-end pipeline test (Milestone 8 hardening):
 *
 *   GLM BLE packet → decodePacket → shouldDispatch/selectSlot →
 *   measurements INSERT → Realtime postgres_changes broadcast →
 *   mergeMeasurement → the list state a re-render would show.
 *
 * The decoder, dispatch gating, slot selection and list-merge are the REAL
 * production functions; only the network edge (PostgREST + Realtime) is faked,
 * with the same insert/channel/filter semantics the app uses.
 */

// useLiveMeasurements imports lib/supabase, which imports react-native at
// module scope — mock it away before anything loads (node test env).
jest.mock("../lib/supabase", () => ({ supabase: {} }));

import { decodePacket, shouldDispatch, selectSlot, SlotKey } from "../hooks/bleDecoder";
import { mergeMeasurement } from "../hooks/useLiveMeasurements";

// ── Packet builders (Bosch GLM 50C frame formats) ────────────────────────────

/** 8+ byte trigger-press frame: C0 55 10 <len> <batt> .. float32le(m) at offset 7 */
function triggerPacket(meters: number, battery = 98): string {
  const bytes = new Uint8Array(11);
  bytes.set([0xc0, 0x55, 0x10, 0x06, battery, 0x00, 0x00]);
  new DataView(bytes.buffer).setFloat32(7, meters, true);
  return Buffer.from(bytes).toString("base64");
}

/** 4-byte continuous heartbeat: C0 <type> <hi> <lo>, big-endian cm */
function heartbeatPacket(cm: number): string {
  return Buffer.from([0xc0, 0x11, (cm >> 8) & 0xff, cm & 0xff]).toString("base64");
}

// ── Fake Supabase edge: PostgREST insert + Realtime broadcast ────────────────

interface Row { [k: string]: unknown; id: string; session_id: string; }

class FakeSupabase {
  rows: Row[] = [];
  private listeners: { filter: string; cb: (payload: { new: Row }) => void }[] = [];

  from(table: string) {
    if (table !== "measurements") throw new Error(`unexpected table ${table}`);
    return {
      insert: async (rows: Row[]) => {
        for (const r of rows) {
          this.rows.push(r);
          // Postgres → Realtime: every INSERT is broadcast to matching filters
          for (const l of this.listeners) {
            const m = /^session_id=eq\.(.+)$/.exec(l.filter);
            if (m && r.session_id === m[1]) l.cb({ new: r });
          }
        }
        return { error: null };
      },
    };
  }

  channel(_name: string) {
    const self = this;
    const chan = {
      on(_evt: string, spec: { filter: string }, cb: (payload: { new: Row }) => void) {
        self.listeners.push({ filter: spec.filter, cb });
        return chan;
      },
      subscribe() { return chan; },
    };
    return chan;
  }
}

/** Minimal stand-in for the component's useState<Measurement[]> — captures what a re-render would show. */
function makeScreen(backend: FakeSupabase, sessionId: string) {
  const screen = { list: [] as Row[] };
  backend
    .channel(`session-live:${sessionId}`)
    .on("postgres_changes",
      { filter: `session_id=eq.${sessionId}` },
      payload => { screen.list = mergeMeasurement(screen.list as any, payload.new as any) as any; })
    .subscribe();
  return screen;
}

const SLOTS: { key: SlotKey }[] = [{ key: "length_mm" }, { key: "height_mm" }, { key: "width_mm" }];

// Row shape mirrors the insert in app/tabs/sessions/inspect.tsx
function toRow(id: string, sessionId: string, value_mm: number, slot: SlotKey, measured_at: string): Row {
  return {
    id, session_id: sessionId, org_id: "org-1", element_id: "el-1",
    value_mm, unit: "mm", measurement_type: slot,
    is_anomaly: false, is_deleted: false, measured_at, ingestion_path: "mobile",
  };
}

// ── The pipeline ─────────────────────────────────────────────────────────────

describe("BLE → insert → realtime → re-render pipeline", () => {
  it("a trigger press flows through decode, dispatch, insert, realtime, and renders exactly once", async () => {
    const backend = new FakeSupabase();
    const screen  = makeScreen(backend, "sess-1");

    // 1. Physical trigger press on the GLM: 1.234 m
    const decoded = decodePacket(triggerPacket(1.234));
    expect(decoded).not.toBeNull();
    expect(decoded!.value_mm).toBeCloseTo(1234, 1);
    expect(decoded!.is_continuous).toBe(false);
    expect(decoded!.battery_level).toBe(98);

    // 2. Trigger presses always dispatch, even when not armed
    expect(shouldDispatch(decoded!, false)).toBe(true);

    // 3. No slot active, none filled → fills length first
    const slot = selectSlot(null, SLOTS, {});
    expect(slot).toBe("length_mm");

    // 4. Optimistic add (what addMeasurement does), then the DB insert
    const row = toRow("m-1", "sess-1", decoded!.value_mm, slot!, decoded!.timestamp);
    screen.list = mergeMeasurement(screen.list as any, row as any) as any;
    await backend.from("measurements").insert([row]);

    // 5. The Realtime echo of the same row must NOT duplicate the entry
    expect(backend.rows).toHaveLength(1);
    expect(screen.list).toHaveLength(1);
    expect(screen.list[0].value_mm).toBeCloseTo(1234, 1);
  });

  it("continuous heartbeats are gated: ignored unarmed, dispatched when armed", async () => {
    const backend = new FakeSupabase();
    const screen  = makeScreen(backend, "sess-1");

    const heartbeat = decodePacket(heartbeatPacket(58)); // 580 mm
    expect(heartbeat!.value_mm).toBe(580);
    expect(heartbeat!.is_continuous).toBe(true);

    // Unarmed: the packet never reaches insert
    expect(shouldDispatch(heartbeat!, false)).toBe(false);
    expect(backend.rows).toHaveLength(0);
    expect(screen.list).toHaveLength(0);

    // Armed (CMD_ENABLE fallback): it flows through
    expect(shouldDispatch(heartbeat!, true)).toBe(true);
    await backend.from("measurements").insert([
      toRow("m-hb", "sess-1", heartbeat!.value_mm, "height_mm", heartbeat!.timestamp),
    ]);
    expect(screen.list).toHaveLength(1);
    expect(screen.list[0].value_mm).toBe(580);
  });

  it("keeps newest-first ordering across multiple realtime inserts", async () => {
    const backend = new FakeSupabase();
    const screen  = makeScreen(backend, "sess-1");

    for (const [i, meters] of [1.0, 2.0, 3.0].entries()) {
      const d = decodePacket(triggerPacket(meters))!;
      await backend.from("measurements").insert([
        toRow(`m-${i}`, "sess-1", d.value_mm, "length_mm", d.timestamp),
      ]);
    }

    expect(screen.list.map(r => r.id)).toEqual(["m-2", "m-1", "m-0"]);
  });

  it("realtime filter isolates sessions: another session's insert never re-renders this screen", async () => {
    const backend = new FakeSupabase();
    const mine    = makeScreen(backend, "sess-1");
    const theirs  = makeScreen(backend, "sess-2");

    const d = decodePacket(triggerPacket(2.5))!;
    await backend.from("measurements").insert([
      toRow("m-x", "sess-2", d.value_mm, "length_mm", d.timestamp),
    ]);

    expect(mine.list).toHaveLength(0);
    expect(theirs.list).toHaveLength(1);
  });

  it("slot selection walks length → height → width as values fill up", () => {
    expect(selectSlot(null, SLOTS, {})).toBe("length_mm");
    expect(selectSlot(null, SLOTS, { length_mm: "1234" })).toBe("height_mm");
    expect(selectSlot(null, SLOTS, { length_mm: "1234", height_mm: "2600" })).toBe("width_mm");
    expect(selectSlot(null, SLOTS, { length_mm: "1", height_mm: "2", width_mm: "3" })).toBeNull();
    // Explicit user selection always wins
    expect(selectSlot("width_mm", SLOTS, {})).toBe("width_mm");
  });

  it("garbage packets never reach the pipeline", () => {
    expect(decodePacket(Buffer.from([0x00, 0x01]).toString("base64"))).toBeNull();
    expect(decodePacket(Buffer.from([0xc0, 0x11, 0xff, 0xff]).toString("base64"))).toBeNull(); // out of range
  });
});
