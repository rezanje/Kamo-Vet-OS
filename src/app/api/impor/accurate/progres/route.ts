import { NextResponse } from "next/server";
import { bacaProgresDariRingkasan } from "@/lib/impor-accurate-batch";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("run_id")?.trim();
  if (!runId) return NextResponse.json({ error: "Batch impor tidak valid" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER" && profile?.role !== "ADMIN") {
    return NextResponse.json({ error: "Akses impor tidak diizinkan" }, { status: 403 });
  }

  const { data, error } = await supabase.from("import_runs").select("summary")
    .eq("id", runId).eq("kind", "master_accurate").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Batch impor tidak ditemukan" }, { status: 404 });
  return NextResponse.json(bacaProgresDariRingkasan(data.summary), {
    headers: { "Cache-Control": "no-store" },
  });
}
