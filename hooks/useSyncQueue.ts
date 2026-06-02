import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { supabase } from "../lib/supabase";

const QUEUE_KEY = "pending_operations";

interface SyncOperation {
  id: string;
  table: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  payload: Record<string, unknown>;
  client_timestamp: string;
  retry_count: number;
}

async function loadQueue(): Promise<SyncOperation[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function saveQueue(queue: SyncOperation[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function useSyncQueue() {
  const draining = useRef(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    loadQueue().then(q => setPendingCount(q.length));
  }, []);

  const enqueue = useCallback(async (op: Omit<SyncOperation, "id" | "client_timestamp" | "retry_count">) => {
    const queue = await loadQueue();
    queue.push({
      ...op,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      client_timestamp: new Date().toISOString(),
      retry_count: 0,
    });
    await saveQueue(queue);
    setPendingCount(queue.length);
  }, []);

  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;

    const queue = await loadQueue();
    if (queue.length === 0) { draining.current = false; return; }

    const remaining: SyncOperation[] = [];

    for (const op of queue) {
      try {
        if (op.operation === "INSERT") {
          const { error } = await supabase.from(op.table).insert(op.payload);
          if (error) throw error;
        } else if (op.operation === "UPDATE") {
          const { id, ...rest } = op.payload as any;
          const { error } = await supabase.from(op.table).update(rest).eq("id", id);
          if (error) throw error;
        } else if (op.operation === "DELETE") {
          const { id } = op.payload as any;
          const { error } = await supabase.from(op.table).delete().eq("id", id);
          if (error) throw error;
        }
        // Successfully synced — don't re-add to queue
      } catch (e) {
        op.retry_count++;
        if (op.retry_count < 5) {
          remaining.push(op);
        }
        // After 5 retries, drop the operation (logged server-side)
      }
    }

    await saveQueue(remaining);
    setPendingCount(remaining.length);
    draining.current = false;
  }, []);

  // Auto-drain when network is restored
  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      if (state.isConnected) drain();
    });
    return unsub;
  }, [drain]);

  return { enqueue, drain, pendingCount };
}
