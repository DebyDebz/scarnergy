import { create } from "zustand";
import { Session, User } from "@supabase/supabase-js";
import { supabase, UserProfile } from "../lib/supabase";

// Keep in sync with DEV_BYPASS_AUTH in app/_layout.tsx
const DEV_BYPASS_AUTH = process.env.EXPO_PUBLIC_DEV_BYPASS_AUTH === 'true';

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
  // Pre-populate profile in dev-bypass mode so the router never waits for auth
  profile: DEV_BYPASS_AUTH ? DEV_PROFILE : null,
  loading: DEV_BYPASS_AUTH ? false : true,

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
    // Use getSession() (a local storage read), NOT getUser() (a network call):
    // the splash gate only needs to know whether a session exists, and getUser
    // adds a round-trip that blocks the sign-in screen if the backend is slow.
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    if (!user) { set({ session: null, user: null, profile: null, loading: false }); return; }
    const { data } = await supabase.from("user_profiles").select("*").eq("id", user.id).single();
    set({ session, user, profile: data ?? null, loading: false });
  },
}));

// Bootstrap: listen for Supabase auth state changes.
// On cold start (app reopened with a stored token), INITIAL_SESSION fires here
// before any component mounts — we must load the profile then too.
supabase.auth.onAuthStateChange((_event, session) => {
  useAuthStore.setState({ session, user: session?.user ?? null });
  if (session) {
    // Defer profile load out of this callback. auth-js (v2) invokes this
    // callback while holding its internal navigator/process lock; calling any
    // supabase.auth.* method (getSession/getUser) synchronously here re-enters
    // the same lock and deadlocks — `loading` stays true and the app spins on
    // the splash screen forever, so the sign-in page never appears.
    setTimeout(() => { useAuthStore.getState().loadProfile(); }, 0);
  } else if (DEV_BYPASS_AUTH) {
    // Dev mode: never reset profile to null — keep DEV_PROFILE stable so
    // INITIAL_SESSION (no stored session) doesn't race with _layout.tsx.
    useAuthStore.setState({ profile: DEV_PROFILE, loading: false });
  } else {
    useAuthStore.setState({ profile: null, loading: false });
  }
});
