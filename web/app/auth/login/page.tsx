import { Suspense } from 'react';
import { LoginForm } from './LoginForm';
import { Zap } from 'lucide-react';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-sm p-8">
        <div className="flex items-center gap-2 mb-8">
          <div className="bg-indigo-600 rounded-lg p-1.5">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-gray-900">Scarnergy</span>
          <span className="text-xs bg-indigo-100 text-indigo-700 rounded px-1.5 py-0.5 font-medium ml-auto">Admin</span>
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-1">Sign in</h1>
        <p className="text-sm text-gray-500 mb-6">Administrator &amp; supervisor portal</p>
        <Suspense fallback={<div className="h-40 animate-pulse bg-gray-100 rounded-lg" />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
