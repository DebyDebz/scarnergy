import { create } from "zustand";
import { Session, User } from "@supabase/supabase-js";
import { supabase, UserProfile } from "../lib/supabase";

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

// Bootstrap: listen for Supabase auth state changes
supabase.auth.onAuthStateChange((_event, session) => {
  useAuthStore.setState({ session, user: session?.user ?? null, loading: false });
});
