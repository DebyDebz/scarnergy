import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { supabase } from "../lib/supabase";
import {
  SyncOperation, enqueueOperation, loadQueue, createDrainCoalescer,
} from "../lib/syncQueue";

// One coalescer for the whole app: every hook instance shares it, so
// simultaneous drains (e.g. dashboard + sessions list both reacting to the
// same network-restore event) execute the queue exactly once.
const drainShared = createDrainCoalescer();

export function useSyncQueue() {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    loadQueue(AsyncStorage).then(q => setPendingCount(q.length));
  }, []);

  const enqueue = useCallback(async (op: Omit<SyncOperation, "id" | "client_timestamp" | "retry_count">) => {
    const queue = await enqueueOperation(AsyncStorage, op);
    setPendingCount(queue.length);
  }, []);

  const drain = useCallback(async () => {
    const remaining = await drainShared(AsyncStorage, supabase);
    setPendingCount(remaining.length);
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
