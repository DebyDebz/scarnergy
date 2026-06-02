import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const base = process.env.AI_SERVER_URL ?? 'http://localhost:8001';
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
    return NextResponse.json({ ok: res.ok }, { status: res.ok ? 200 : 502 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'unreachable' }, { status: 502 });
  }
}
