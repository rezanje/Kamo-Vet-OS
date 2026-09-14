import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { jalankanWaEngine } from "@/lib/wa-engine";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY belum diset" }, { status: 501 });
  const supabase = createServiceClient(url, serviceKey, { auth: { persistSession: false } });
  return NextResponse.json({ ok: true, hasil: await jalankanWaEngine(supabase) });
}
