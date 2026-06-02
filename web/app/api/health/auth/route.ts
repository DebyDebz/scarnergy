import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return NextResponse.json({ ok: res.ok }, { status: res.ok ? 200 : 502 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'unreachable' }, { status: 502 });
  }
}
