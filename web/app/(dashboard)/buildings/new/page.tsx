import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AddBuildingForm } from '@/components/buildings/AddBuildingForm';
import { AppsheetAddBuildingForm } from '@/components/buildings/AppsheetAddBuildingForm';
import { getServerDataSource } from '@/lib/dataSource/serverSource';
import { appsheetFind } from '@/lib/appsheet/client';
import { mapBedrijvenRow } from '@/lib/appsheet/mappers';

export default async function NewBuildingPage() {
  const source = await getServerDataSource();
  const isAppsheet = source === 'appsheet';

  let orgs: ReturnType<typeof mapBedrijvenRow>[] = [];
  if (isAppsheet) {
    const result = await appsheetFind('Bedrijven');
    orgs = Array.isArray(result) ? result.map(mapBedrijvenRow) : [];
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link href="/buildings" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3">
          <ArrowLeft className="w-4 h-4" /> Buildings
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Add building</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {isAppsheet ? 'Register a new building in AppSheet (Objecten)' : 'Register a new building for inspection'}
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {isAppsheet ? <AppsheetAddBuildingForm orgs={orgs} /> : <AddBuildingForm />}
      </div>
    </div>
  );
}
