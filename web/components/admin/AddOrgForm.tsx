'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building, Plus, Search } from 'lucide-react';
import type { Role } from '@/lib/types';

interface AvailableUser {
  id: string;
  full_name: string;
  role: Role;
}

interface AvailableBuilding {
  id: string;
  reference_code: string;
  full_address: string;
}

interface Props {
  availableUsers: AvailableUser[];
  availableBuildings: AvailableBuilding[];
}

export function AddOrgForm({ availableUsers, availableBuildings }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedBuildingIds, setSelectedBuildingIds] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [buildingSearch, setBuildingSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setName(''); setAddress(''); setPostalCode(''); setCity('');
    setLatitude(''); setLongitude('');
    setSelectedUserIds([]); setSelectedBuildingIds([]);
    setUserSearch(''); setBuildingSearch('');
    setError('');
  }

  function toggleUser(id: string) {
    setSelectedUserIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function toggleBuilding(id: string) {
    setSelectedBuildingIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  const filteredUsers = availableUsers.filter(u =>
    u.full_name.toLowerCase().includes(userSearch.toLowerCase())
  );

  const filteredBuildings = availableBuildings.filter(b =>
    b.reference_code.toLowerCase().includes(buildingSearch.toLowerCase()) ||
    b.full_address.toLowerCase().includes(buildingSearch.toLowerCase())
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/organisations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, address, city, postal_code: postalCode,
        latitude, longitude,
        user_ids: selectedUserIds,
        building_ids: selectedBuildingIds,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Failed to create organisation');
      setLoading(false);
    } else {
      reset();
      setOpen(false);
      router.refresh();
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
      >
        <Plus className="w-4 h-4" />
        New organisation
      </button>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-5">
        <div className="bg-indigo-100 rounded-lg p-2">
          <Building className="w-4 h-4 text-indigo-600" />
        </div>
        <h2 className="font-semibold text-gray-900 text-sm">New organisation</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Company Name */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Company Name <span className="text-red-500">*</span>
          </label>
          <input
            required
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Acme Inspections BV"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Full Address */}
        <fieldset>
          <legend className="block text-xs font-medium text-gray-700 mb-2">Full Address</legend>
          <div className="space-y-2">
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="Street address"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                value={postalCode}
                onChange={e => setPostalCode(e.target.value)}
                placeholder="Postal code"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                value={city}
                onChange={e => setCity(e.target.value)}
                placeholder="City"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </fieldset>

        {/* GPS Location */}
        <fieldset>
          <legend className="block text-xs font-medium text-gray-700 mb-2">GPS Location</legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Latitude</label>
              <input
                type="number"
                step="any"
                value={latitude}
                onChange={e => setLatitude(e.target.value)}
                placeholder="52.370216"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Longitude</label>
              <input
                type="number"
                step="any"
                value={longitude}
                onChange={e => setLongitude(e.target.value)}
                placeholder="4.895168"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </fieldset>

        {/* Linked Supervisors / Inspectors */}
        <fieldset>
          <legend className="block text-xs font-medium text-gray-700 mb-2">
            Linked Supervisors / Inspectors
            {selectedUserIds.length > 0 && (
              <span className="ml-2 text-indigo-600 font-semibold">{selectedUserIds.length} selected</span>
            )}
          </legend>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="relative border-b border-gray-100">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                placeholder="Search users…"
                className="w-full pl-8 pr-3 py-2 text-xs focus:outline-none"
              />
            </div>
            <div className="max-h-36 overflow-y-auto divide-y divide-gray-50">
              {filteredUsers.length === 0 ? (
                <p className="px-3 py-3 text-xs text-gray-400 text-center">No users found</p>
              ) : filteredUsers.map(u => (
                <label
                  key={u.id}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedUserIds.includes(u.id)}
                    onChange={() => toggleUser(u.id)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-gray-800 flex-1">{u.full_name}</span>
                  <span className="text-xs text-gray-400 capitalize">{u.role}</span>
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        {/* Linked Buildings */}
        <fieldset>
          <legend className="block text-xs font-medium text-gray-700 mb-2">
            Linked Buildings
            {selectedBuildingIds.length > 0 && (
              <span className="ml-2 text-indigo-600 font-semibold">{selectedBuildingIds.length} selected</span>
            )}
          </legend>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="relative border-b border-gray-100">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                value={buildingSearch}
                onChange={e => setBuildingSearch(e.target.value)}
                placeholder="Search buildings…"
                className="w-full pl-8 pr-3 py-2 text-xs focus:outline-none"
              />
            </div>
            <div className="max-h-36 overflow-y-auto divide-y divide-gray-50">
              {filteredBuildings.length === 0 ? (
                <p className="px-3 py-3 text-xs text-gray-400 text-center">No buildings found</p>
              ) : filteredBuildings.map(b => (
                <label
                  key={b.id}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedBuildingIds.includes(b.id)}
                    onChange={() => toggleBuilding(b.id)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="font-mono text-xs text-gray-500 shrink-0">{b.reference_code}</span>
                  <span className="text-sm text-gray-700 truncate">{b.full_address}</span>
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            <Building className="w-4 h-4" />
            {loading ? 'Creating…' : 'Create organisation'}
          </button>
          <button
            type="button"
            onClick={() => { reset(); setOpen(false); }}
            className="text-sm font-medium px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
