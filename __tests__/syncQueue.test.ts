/**
 * Offline sync-queue stress tests (Milestone 8 hardening).
 *
 * Simulates the field failure mode: an inspector loses network mid-session,
 * measurements pile up in the AsyncStorage queue, the network comes back and
 * the queue drains — possibly from several mounted hooks at once.
 */
import {
  QUEUE_KEY, MAX_RETRIES, SyncOperation, KeyValueStorage,
  loadQueue, saveQueue, enqueueOperation, drainQueue, createDrainCoalescer,
} from "../lib/syncQueue";

// ── Fakes ────────────────────────────────────────────────────────────────────

function memStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: async k => data.get(k) ?? null,
    setItem: async (k, v) => { data.set(k, v); },
  };
}

interface Call {
  table: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  payload: unknown;
  eqArgs?: [string, unknown];
}

/** Supabase stand-in. `shouldFail` decides per call whether the network "drops". */
function fakeClient(shouldFail: (call: Call, index: number) => boolean = () => false) {
  const calls: Call[] = [];
  const respond = (call: Call) => {
    calls.push(call);
    const fail = shouldFail(call, calls.length - 1);
    return Promise.resolve({ error: fail ? new Error("TypeError: Network request failed") : null });
  };
  return {
    calls,
    from(table: string) {
      return {
        insert: (payload: unknown) => respond({ table, op: "INSERT" as const, payload }),
        update: (payload: unknown) => ({
          eq: (col: string, val: unknown) =>
            respond({ table, op: "UPDATE" as const, payload, eqArgs: [col, val] }),
        }),
        delete: () => ({
          eq: (col: string, val: unknown) =>
            respond({ table, op: "DELETE" as const, payload: null, eqArgs: [col, val] }),
        }),
      };
    },
  };
}

const measurementOp = (n: number) => ({
  table: "measurements",
  operation: "INSERT" as const,
  payload: { session_id: "sess-1", value_mm: 1000 + n, unit: "mm", ingestion_path: "mobile" },
});

// ── Enqueue ──────────────────────────────────────────────────────────────────

describe("enqueueOperation", () => {
  it("persists operations with retry_count 0 and a client timestamp", async () => {
    const storage = memStorage();
    await enqueueOperation(storage, measurementOp(1));
    const queue = await enqueueOperation(storage, measurementOp(2));

    expect(queue).toHaveLength(2);
    expect(queue[0].retry_count).toBe(0);
    expect(queue[0].id).toBeTruthy();
    expect(new Date(queue[0].client_timestamp).getTime()).not.toBeNaN();

    // Round-trips through storage, not just memory
    expect(await loadQueue(storage)).toHaveLength(2);
  });
});

// ── Drain: happy path ────────────────────────────────────────────────────────

describe("drainQueue", () => {
  it("executes INSERT/UPDATE/DELETE with the correct client calls, FIFO, and empties the queue", async () => {
    const storage = memStorage();
    await enqueueOperation(storage, measurementOp(1));
    await enqueueOperation(storage, {
      table: "building_elements", operation: "UPDATE",
      payload: { id: "el-1", rc_value: 2.5 },
    });
    await enqueueOperation(storage, {
      table: "measurements", operation: "DELETE", payload: { id: "m-9" },
    });

    const client = fakeClient();
    const remaining = await drainQueue(storage, client);

    expect(remaining).toHaveLength(0);
    expect(await loadQueue(storage)).toHaveLength(0);
    expect(client.calls.map(c => c.op)).toEqual(["INSERT", "UPDATE", "DELETE"]);
    // UPDATE strips id from the payload and targets it via eq()
    expect(client.calls[1].payload).toEqual({ rc_value: 2.5 });
    expect(client.calls[1].eqArgs).toEqual(["id", "el-1"]);
    expect(client.calls[2].eqArgs).toEqual(["id", "m-9"]);
  });

  it("is a no-op on an empty queue", async () => {
    const client = fakeClient();
    expect(await drainQueue(memStorage(), client)).toHaveLength(0);
    expect(client.calls).toHaveLength(0);
  });

  it("network drop mid-drain: synced ops leave the queue, failed ops stay with retry_count bumped", async () => {
    const storage = memStorage();
    for (let n = 0; n < 5; n++) await enqueueOperation(storage, measurementOp(n));

    // First 2 calls succeed, then the connection "drops"
    const flaky = fakeClient((_c, i) => i >= 2);
    const remaining = await drainQueue(storage, flaky);

    expect(remaining).toHaveLength(3);
    expect(remaining.every(op => op.retry_count === 1)).toBe(true);
    // Order of the survivors is preserved
    expect(remaining.map(op => (op.payload as any).value_mm)).toEqual([1002, 1003, 1004]);

    // Network restored: everything syncs
    const healthy = fakeClient();
    expect(await drainQueue(storage, healthy)).toHaveLength(0);
    expect(healthy.calls).toHaveLength(3);
  });

  it("a failing operation does not block the operations behind it", async () => {
    const storage = memStorage();
    for (let n = 0; n < 3; n++) await enqueueOperation(storage, measurementOp(n));

    // Only the middle op fails
    const client = fakeClient(c => (c.payload as any)?.value_mm === 1001);
    const remaining = await drainQueue(storage, client);

    expect(client.calls).toHaveLength(3); // all three attempted
    expect(remaining).toHaveLength(1);
    expect((remaining[0].payload as any).value_mm).toBe(1001);
  });

  it(`drops an operation after ${MAX_RETRIES} failed attempts`, async () => {
    const storage = memStorage();
    await enqueueOperation(storage, measurementOp(1));
    const dead = fakeClient(() => true); // permanent failure (e.g. RLS reject)

    for (let attempt = 1; attempt < MAX_RETRIES; attempt++) {
      const remaining = await drainQueue(storage, dead);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].retry_count).toBe(attempt);
    }
    // Attempt #MAX_RETRIES: dropped, queue permanently clear
    expect(await drainQueue(storage, dead)).toHaveLength(0);
    expect(await loadQueue(storage)).toHaveLength(0);
    expect(dead.calls).toHaveLength(MAX_RETRIES);
  });

  it("stress: 50 measurements queued offline all survive and sync in order on reconnect", async () => {
    const storage = memStorage();
    for (let n = 0; n < 50; n++) await enqueueOperation(storage, measurementOp(n));

    // Airplane mode: every call fails
    const offline = fakeClient(() => true);
    const afterOffline = await drainQueue(storage, offline);
    expect(afterOffline).toHaveLength(50);
    expect(afterOffline.every(op => op.retry_count === 1)).toBe(true);

    // Reconnect: all 50 sync, FIFO order intact
    const online = fakeClient();
    expect(await drainQueue(storage, online)).toHaveLength(0);
    expect(online.calls).toHaveLength(50);
    expect(online.calls.map(c => (c.payload as any).value_mm))
      .toEqual(Array.from({ length: 50 }, (_, n) => 1000 + n));
  });
});

// ── Concurrent drains (multiple mounted hooks) ───────────────────────────────

describe("createDrainCoalescer", () => {
  it("two concurrent drains execute each operation exactly once", async () => {
    const storage = memStorage();
    await enqueueOperation(storage, measurementOp(1));
    await enqueueOperation(storage, measurementOp(2));

    // Client that blocks until we release it, so both drains overlap for sure
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const calls: unknown[] = [];
    const slowClient = {
      from: () => ({
        insert: async (payload: unknown) => { calls.push(payload); await gate; return { error: null }; },
        update: () => ({ eq: async () => ({ error: null }) }),
        delete: () => ({ eq: async () => ({ error: null }) }),
      }),
    };

    const drain = createDrainCoalescer();
    const p1 = drain(storage, slowClient);
    const p2 = drain(storage, slowClient); // fired while p1 is mid-flight
    release();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(calls).toHaveLength(2);       // 2 ops, once each — not 4
    expect(r1).toHaveLength(0);
    expect(r2).toBe(r1);                 // second caller joined the same pass
  });

  it("a drain after the previous pass finished runs fresh", async () => {
    const storage = memStorage();
    const drain = createDrainCoalescer();

    await enqueueOperation(storage, measurementOp(1));
    const c1 = fakeClient();
    await drain(storage, c1);
    expect(c1.calls).toHaveLength(1);

    await enqueueOperation(storage, measurementOp(2));
    const c2 = fakeClient();
    await drain(storage, c2);
    expect(c2.calls).toHaveLength(1); // new pass, new queue content
  });
});

// ── Storage round-trip sanity ────────────────────────────────────────────────

describe("queue persistence", () => {
  it("uses the same storage key the app has always used", async () => {
    expect(QUEUE_KEY).toBe("pending_operations"); // pre-refactor queues must keep draining
  });

  it("save/load round-trips operations losslessly", async () => {
    const storage = memStorage();
    const ops: SyncOperation[] = [{
      id: "op-1", table: "measurements", operation: "INSERT",
      payload: { value_mm: 1234.5 }, client_timestamp: "2026-07-13T10:00:00.000Z", retry_count: 3,
    }];
    await saveQueue(storage, ops);
    expect(await loadQueue(storage)).toEqual(ops);
  });
});
