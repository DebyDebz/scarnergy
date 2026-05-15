"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

interface Props {
  fullName: string;
  orgName: string;
}

export function TopBar({ fullName, orgName }: Props) {
  const router   = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
      <span className="text-sm font-semibold text-gray-600">{orgName}</span>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-medium text-gray-800">{fullName}</p>
        </div>
        <button
          onClick={signOut}
          className="text-sm text-gray-500 hover:text-red-600 transition-colors"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
