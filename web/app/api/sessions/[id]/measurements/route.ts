import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id, org_id")
    .eq("id", user.id)
    .single();
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 403 });

  const { data: session } = await supabase
    .from("inspection_sessions")
    .select("id, status")
    .eq("id", sessionId)
    .single();
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (session.status !== "active")
    return NextResponse.json({ error: "Session is not active" }, { status: 400 });

  let body: { value_mm: unknown; element_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const value_mm = Number(body.value_mm);
  if (isNaN(value_mm))
    return NextResponse.json({ error: "value_mm must be a number" }, { status: 400 });

  const is_anomaly = value_mm < 0 || value_mm > 50_000;
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("measurements")
    .insert({
      org_id:           (profile as any).org_id,
      session_id:       sessionId,
      inspector_id:     (profile as any).id,
      element_id:       (body.element_id as string) ?? null,
      value_mm,
      unit:             "mm",
      ingestion_path:   "web",
      is_anomaly,
      client_timestamp: now,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
