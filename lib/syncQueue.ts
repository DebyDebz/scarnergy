// Pure sync-queue core, extracted from hooks/useSyncQueue so the offline
// behaviour can be unit-tested without React or native modules (the jest
// setup is ts-jest/node). The hook is a thin wrapper binding this to
// AsyncStorage + the real supabase client.

export const QUEUE_KEY = "pending_operations";
export const MAX_RETRIES = 5;

export interface SyncOperation {
  id: string;
  table: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  payload: Record<string, unknown>;
  client_timestamp: string;
  retry_count: number;
}

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

// Minimal structural slice of the supabase client that the queue needs.
interface TableOps {
  insert(payload: unknown): PromiseLike<{ error: unknown }>;
  update(payload: unknown): { eq(column: string, value: unknown): PromiseLike<{ error: unknown }> };
  delete(): { eq(column: string, value: unknown): PromiseLike<{ error: unknown }> };
}
export interface SyncClient {
  from(table: string): TableOps;
}

export async function loadQueue(storage: KeyValueStorage): Promise<SyncOperation[]> {
  const raw = await storage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function saveQueue(storage: KeyValueStorage, queue: SyncOperation[]): Promise<void> {
  await storage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function createOperation(
  op: Omit<SyncOperation, "id" | "client_timestamp" | "retry_count">
): SyncOperation {
  return {
    ...op,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    client_timestamp: new Date().toISOString(),
    retry_count: 0,
  };
}

export async function enqueueOperation(
  storage: KeyValueStorage,
  op: Omit<SyncOperation, "id" | "client_timestamp" | "retry_count">
): Promise<SyncOperation[]> {
  const queue = await loadQueue(storage);
  queue.push(createOperation(op));
  await saveQueue(storage, queue);
  return queue;
}

async function executeOperation(client: SyncClient, op: SyncOperation): Promise<void> {
  if (op.operation === "INSERT") {
    const { error } = await client.from(op.table).insert(op.payload);
    if (error) throw error;
  } else if (op.operation === "UPDATE") {
    const { id, ...rest } = op.payload as { id: unknown };
    const { error } = await client.from(op.table).update(rest).eq("id", id);
    if (error) throw error;
  } else {
    const { id } = op.payload as { id: unknown };
    const { error } = await client.from(op.table).delete().eq("id", id);
    if (error) throw error;
  }
}

/**
 * Runs every queued operation once, in FIFO order. A failed operation is kept
 * for a later pass (retry_count + 1) until MAX_RETRIES, then dropped; failures
 * never block the operations behind them. Returns the remaining queue.
 */
export async function drainQueue(
  storage: KeyValueStorage,
  client: SyncClient
): Promise<SyncOperation[]> {
  const queue = await loadQueue(storage);
  if (queue.length === 0) return queue;

  const remaining: SyncOperation[] = [];
  for (const op of queue) {
    try {
      await executeOperation(client, op);
    } catch {
      op.retry_count++;
      if (op.retry_count < MAX_RETRIES) remaining.push(op);
      // At MAX_RETRIES the operation is dropped (server logs the loss).
    }
  }

  await saveQueue(storage, remaining);
  return remaining;
}

/**
 * Coalesces concurrent drain calls into a single pass. Several useSyncQueue
 * instances are mounted at once (dashboard, sessions list) and each auto-drains
 * on the same network-restore event; without a shared guard two passes would
 * load the same queue and double-insert every operation. The previous per-hook
 * useRef guard could not protect across instances.
 */
export function createDrainCoalescer() {
  let inflight: Promise<SyncOperation[]> | null = null;
  return (storage: KeyValueStorage, client: SyncClient): Promise<SyncOperation[]> => {
    if (!inflight) {
      inflight = drainQueue(storage, client).finally(() => { inflight = null; });
    }
    return inflight;
  };
}
