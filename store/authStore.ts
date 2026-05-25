import { create } from "zustand";
import { Session, User } from "@supabase/supabase-js";
import { supabase, UserProfile } from "../lib/supabase";

// Keep in sync with DEV_BYPASS_AUTH in app/_layout.tsx
const DEV_BYPASS_AUTH = true;

const DEV_PROFILE: UserProfile = {
  id:        "00000000-0000-0000-0000-000000000000",
  org_id:    "00000000-0000-0000-0000-000000000001",
  role:      "admin",
  full_name: "Dev User",
  is_active: true,
};

interface AuthState {
  session:  Session | null;
  user:     User | null;
  profile:  UserProfile | null;
  loading:  boolean;
  signIn:   (email: string, password: string) => Promise<void>;
  signOut:  () => Promise<void>;
  loadProfile: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user:    null,
  profile: null,
  loading: true,

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    set({ session: data.session, user: data.user });
    await get().loadProfile();
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, profile: null });
  },

  loadProfile: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { set({ loading: false }); return; }
    const { data } = await supabase.from("user_profiles").select("*").eq("id", user.id).single();
    set({ user, profile: data ?? null, loading: false });
  },
}));

// Bootstrap: listen for Supabase auth state changes.
// On cold start (app reopened with a stored token), INITIAL_SESSION fires here
// before any component mounts — we must load the profile then too.
supabase.auth.onAuthStateChange((_event, session) => {
  useAuthStore.setState({ session, user: session?.user ?? null });
  if (session) {
    useAuthStore.getState().loadProfile();
  } else if (DEV_BYPASS_AUTH) {
    // Dev mode: never reset profile to null — keep DEV_PROFILE stable so
    // INITIAL_SESSION (no stored session) doesn't race with _layout.tsx.
    useAuthStore.setState({ profile: DEV_PROFILE, loading: false });
  } else {
    useAuthStore.setState({ profile: null, loading: false });
  }
});
