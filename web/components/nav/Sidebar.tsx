'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Building2, ClipboardList, Users,
  Building, Bluetooth, Zap, Ruler, ShieldCheck
} from 'lucide-react';
import type { Role } from '@/lib/types';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['inspector', 'supervisor', 'admin'] as Role[] },
  { href: '/buildings', label: 'Buildings', icon: Building2, roles: ['supervisor', 'admin'] as Role[] },
  { href: '/sessions', label: 'Sessions', icon: ClipboardList, roles: ['supervisor', 'admin'] as Role[] },
  { href: '/measurements', label: 'Measurements', icon: Ruler, roles: ['supervisor', 'admin'] as Role[] },
  { href: '/quality', label: 'Quality', icon: ShieldCheck, roles: ['supervisor', 'admin'] as Role[] },
  { href: '/users', label: 'Users', icon: Users, roles: ['admin'] as Role[] },
  { href: '/organizations', label: 'Organizations', icon: Building, roles: ['admin'] as Role[] },
  { href: '/devices', label: 'BLE Devices', icon: Bluetooth, roles: ['admin'] as Role[] },
];

export function Sidebar({ role }: { role: Role }) {
  const path = usePathname();
  const visible = NAV.filter(n => n.roles.includes(role));

  return (
    <aside className="w-56 shrink-0 flex flex-col bg-white border-r border-gray-200 h-screen sticky top-0">
      <div className="flex items-center gap-2 px-4 py-5 border-b border-gray-100">
        <div className="bg-indigo-600 rounded-lg p-1.5">
          <Zap className="w-4 h-4 text-white" />
        </div>
        <span className="font-bold text-gray-900">Scarnergy</span>
        <span className="text-[10px] bg-indigo-100 text-indigo-700 rounded px-1.5 py-0.5 font-semibold ml-auto">
          {role.toUpperCase()}
        </span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {visible.map(({ href, label, icon: Icon }) => {
          const active = path === href || (href !== '/dashboard' && path.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400">
        v2.0 — Scarnergy Admin
      </div>
    </aside>
  );
}
