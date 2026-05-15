import { redirect } from "next/navigation";
import { createClient } from "./supabase-server";
import type { UserProfile } from "./types";

export async function requireProfile(): Promise<{ supabase: Awaited<ReturnType<typeof createClient>>; profile: UserProfile }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const profile = data as UserProfile | null;
  if (!profile) redirect("/auth/no-profile");

  return { supabase, profile };
}
