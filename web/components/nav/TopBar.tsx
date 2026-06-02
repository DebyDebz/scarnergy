'use client';
import { useRouter } from 'next/navigation';
import { LogOut, ChevronDown } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useState } from 'react';

interface Props {
  fullName: string;
  orgName: string;
}

export function TopBar({ fullName, orgName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/auth/login');
    router.refresh();
  }

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
      <div className="text-sm text-gray-500">
        <span className="font-medium text-gray-800">{orgName}</span>
        <span className="mx-1.5 text-gray-300">·</span>
        Admin Panel
      </div>
      <div className="relative">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900 rounded-lg px-3 py-1.5 hover:bg-gray-100 transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold text-xs">
            {fullName?.charAt(0)?.toUpperCase() ?? '?'}
          </div>
          <span className="font-medium">{fullName}</span>
          <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
        </button>
        {open && (
          <div className="absolute right-0 top-10 bg-white border border-gray-200 rounded-xl shadow-lg w-44 py-1 z-50">
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
