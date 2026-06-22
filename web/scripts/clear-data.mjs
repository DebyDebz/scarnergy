// One-off: clear inspection/building data, keep users, organisations, BLE devices.
// Usage: node scripts/clear-data.mjs            (dry-run: counts only)
//        node scripts/clear-data.mjs --confirm  (actually delete)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// Load env from web/.env.local
const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');

const sb = createClient(url, key, { auth: { persistSession: false } });
const CONFIRM = process.argv.includes('--confirm');

// Child -> parent order so FK constraints never block a delete.
const TABLES = [
  'measurements',
  'openings',
  'building_facade_photos',
  'building_elements',
  'zones',
  'inspection_sessions',
  'sync_queue',
  'audit_log',
  'buildings',
];

// Storage buckets holding building/inspection files (NOT user avatars/profiles).
const BUCKETS = ['floor-plans', 'facade-photos'];

async function count(t) {
  const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true });
  return error ? `err: ${error.message}` : count;
}

console.log(`Mode: ${CONFIRM ? 'DELETE' : 'DRY-RUN (counts only)'}\nTarget: ${url}\n`);

console.log('Current row counts:');
for (const t of TABLES) console.log(`  ${t.padEnd(24)} ${await count(t)}`);
console.log('Kept (untouched): organisations, user_profiles, ble_devices\n');

if (!CONFIRM) {
  console.log('Dry run. Re-run with --confirm to delete.');
  process.exit(0);
}

for (const t of TABLES) {
  const { error } = await sb.from(t).delete().not('id', 'is', null);
  console.log(`  deleted ${t.padEnd(24)} ${error ? 'ERROR: ' + error.message : 'ok -> ' + (await count(t)) + ' left'}`);
}

console.log('\nStorage:');
for (const b of BUCKETS) {
  // List recursively one level: list root, then each folder.
  const removeAll = async (prefix = '') => {
    const { data, error } = await sb.storage.from(b).list(prefix, { limit: 1000 });
    if (error) { console.log(`  ${b}/${prefix} list error: ${error.message}`); return 0; }
    let n = 0;
    const files = [], folders = [];
    for (const e of data) (e.id ? files : folders).push(e);
    if (files.length) {
      const paths = files.map(f => (prefix ? prefix + '/' : '') + f.name);
      const { error: delErr } = await sb.storage.from(b).remove(paths);
      if (delErr) console.log(`  ${b} remove error: ${delErr.message}`);
      else n += paths.length;
    }
    for (const f of folders) n += await removeAll((prefix ? prefix + '/' : '') + f.name);
    return n;
  };
  const removed = await removeAll('');
  console.log(`  ${b.padEnd(16)} removed ${removed} file(s)`);
}

console.log('\nDone.');
