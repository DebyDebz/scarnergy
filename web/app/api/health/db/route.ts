import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

export async function GET() {
  try {
    const supabase = await createServiceClient();
    const { data, error } = await supabase.from('organisations').select('id').limit(1);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
    return NextResponse.json({ ok: true, rows: data?.length });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'unreachable' }, { status: 502 });
  }
}
