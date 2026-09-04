import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase-server';
import { RequestAccessForm } from './RequestAccessForm';
import { Zap } from 'lucide-react';
import type { Organisation } from '@/lib/types';

export const revalidate = 0;

export default async function RequestAccessPage() {
  // Anonymous visitors can't read `organisations` under RLS (it's scoped to
  // the caller's own org_id, and there is no caller yet) — service-role,
  // server-side only, same as /api/auth/signup's org creation.
  const serviceClient = await createServiceClient();
  const { data } = await serviceClient.from('organisations').select('id, name').order('name');
  const orgs = (data ?? []) as Pick<Organisation, 'id' | 'name'>[];

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-sm p-8">
        <div className="flex items-center gap-2 mb-8">
          <div className="bg-indigo-600 rounded-lg p-1.5">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-gray-900">Scarnergy</span>
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-1">Request access</h1>
        <p className="text-sm text-gray-500 mb-6">
          Joining a team that already uses Scarnergy? Request access below — an admin will need to approve you before you can sign in.
        </p>
        <RequestAccessForm orgs={orgs} />
        <p className="text-sm text-gray-500 mt-6 text-center">
          Already approved?{' '}
          <Link href="/auth/login" className="text-indigo-600 hover:underline font-medium">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
