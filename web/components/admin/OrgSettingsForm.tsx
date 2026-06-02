'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase';
import { Save } from 'lucide-react';

interface Props {
  orgId: string;
  initialSettings: Record<string, unknown>;
}

export function OrgSettingsForm({ orgId, initialSettings }: Props) {
  const [text, setText] = useState(JSON.stringify(initialSettings, null, 2));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function handleSave() {
    setSaving(true);
    setMsg('');
    setError('');
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError('Invalid JSON');
      setSaving(false);
      return;
    }
    const supabase = createClient();
    const { error: err } = await (supabase.from('organisations') as any)
      .update({ settings: parsed })
      .eq('id', orgId);
    if (err) setError(err.message);
    else setMsg('Saved');
    setSaving(false);
  }

  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1.5">Settings (JSON)</label>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={6}
        className="w-full font-mono text-xs rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
      />
      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-indigo-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {msg && <span className="text-xs text-emerald-600">{msg}</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}
