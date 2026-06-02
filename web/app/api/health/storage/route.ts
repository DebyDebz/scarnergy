import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/health`;
    const res = await fetch(url, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      signal: AbortSignal.timeout(3000),
    });
    return NextResponse.json({ ok: res.ok }, { status: res.ok ? 200 : 502 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'unreachable' }, { status: 502 });
  }
}
