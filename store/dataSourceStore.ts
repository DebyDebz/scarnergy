import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Mirrors the web dashboard's DataSourceContext (web/lib/dataSource/
// DataSourceContext.tsx) — same storage key, same two values — so a "which
// source is active" mental model is consistent across web and mobile, even
// though the persistence mechanism differs (localStorage+cookie on web,
// AsyncStorage here).
export type DataSource = "scanergy" | "appsheet";

const STORAGE_KEY = "scanergy:data-source";

interface DataSourceState {
  source: DataSource;
  hydrated: boolean;
  setSource: (source: DataSource) => void;
}

export const useDataSourceStore = create<DataSourceState>((set) => ({
  source: "scanergy",
  hydrated: false,
  setSource: (source) => {
    set({ source });
    AsyncStorage.setItem(STORAGE_KEY, source).catch(() => {});
  },
}));

AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
  if (stored === "appsheet" || stored === "scanergy") {
    useDataSourceStore.setState({ source: stored, hydrated: true });
  } else {
    useDataSourceStore.setState({ hydrated: true });
  }
});
