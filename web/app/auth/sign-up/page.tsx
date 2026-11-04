import Link from 'next/link';
import { SignUpForm } from './SignUpForm';
import { Zap } from 'lucide-react';

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-sm p-8">
        <div className="flex items-center gap-2 mb-8">
          <div className="bg-indigo-600 rounded-lg p-1.5">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-gray-900">Scarnergy</span>
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-1">Create your organisation</h1>
        <p className="text-sm text-gray-500 mb-6">You&apos;ll be the first admin — invite your team once you&apos;re in.</p>
        <SignUpForm />
        <p className="text-sm text-gray-500 mt-4 text-center">
          Joining a team that already uses Scarnergy?{' '}
          <Link href="/auth/request-access" className="text-indigo-600 hover:underline font-medium">Request access</Link>
        </p>
        <p className="text-sm text-gray-500 mt-2 text-center">
          Already have an account?{' '}
          <Link href="/auth/login" className="text-indigo-600 hover:underline font-medium">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
