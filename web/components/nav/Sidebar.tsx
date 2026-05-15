"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/types";

interface NavItem {
  label: string;
  href: string;
  icon: string;
  roles: Role[];
}

const NAV: NavItem[] = [
  { label: "Dashboard",  href: "/dashboard",  icon: "⊞", roles: ["supervisor", "admin"] },
  { label: "Buildings",  href: "/buildings",  icon: "🏢", roles: ["supervisor", "admin"] },
  { label: "Sessions",   href: "/sessions",   icon: "📋", roles: ["supervisor", "admin"] },
  { label: "Anomalies",  href: "/anomalies",  icon: "⚠", roles: ["supervisor", "admin"] },
  { label: "Connect GLM",href: "/devices",    icon: "📡", roles: ["supervisor", "admin"] },
  { label: "Reports",    href: "/reports",    icon: "📄", roles: ["supervisor", "admin"] },
  { label: "Inspectors", href: "/inspectors", icon: "👷", roles: ["admin"] },
];

interface Props {
  role: Role;
}

export function Sidebar({ role }: Props) {
  const pathname = usePathname();

  const visibleLinks = NAV.filter(item => item.roles.includes(role));

  return (
    <aside className="w-56 shrink-0 bg-brand-700 flex flex-col min-h-screen">
      {/* Brand */}
      <div className="px-6 py-6 border-b border-brand-800">
        <span className="text-white font-bold text-lg tracking-tight">Scarnergy</span>
        <span className="block text-brand-100 text-xs mt-0.5">Supervisor Dashboard</span>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {visibleLinks.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                ${active
                  ? "bg-brand-500 text-white"
                  : "text-brand-100 hover:bg-brand-800 hover:text-white"
                }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Role badge at bottom */}
      <div className="px-6 py-4 border-t border-brand-800">
        <span className="text-xs text-brand-100 uppercase tracking-widest">{role}</span>
      </div>
    </aside>
  );
}
