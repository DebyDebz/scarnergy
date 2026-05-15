import { requireProfile } from "@/lib/auth";
import { Sidebar } from "@/components/nav/Sidebar";
import { TopBar } from "@/components/nav/TopBar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile } = await requireProfile();

  const { data: org } = await supabase
    .from("organisations")
    .select("name")
    .eq("id", profile.org_id)
    .single();

  return (
    <div className="flex min-h-screen">
      <Sidebar role={profile.role} />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar fullName={profile.full_name} orgName={(org as { name: string } | null)?.name ?? ""} />
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
