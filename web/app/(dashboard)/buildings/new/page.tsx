import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AddBuildingForm } from '@/components/buildings/AddBuildingForm';

export default function NewBuildingPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link href="/buildings" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3">
          <ArrowLeft className="w-4 h-4" /> Buildings
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Add building</h1>
        <p className="text-sm text-gray-500 mt-0.5">Register a new building for inspection</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <AddBuildingForm />
      </div>
    </div>
  );
}
