import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const maxDuration = 60;

// Payment commits independently of staff rewards. This bounded daily retry
// drains only jobs captured by the payment finalizer, in database order.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "retry unavailable" }, { status: 501 });

  const supabase = createServiceClient(url, serviceKey, { auth: { persistSession: false } });
  try {
    const { data, error } = await supabase.rpc("process_pending_quest_jobs", { p_limit: 50 });
    if (error) throw error;
    const applied = Number(data?.applied);
    const voided = Number(data?.voided);
    const failed = Number(data?.failed);
    const remaining = Number(data?.remaining);
    if (![applied, voided, failed, remaining].every(Number.isSafeInteger)
      || applied < 0 || voided < 0 || failed < 0 || remaining < 0
      || applied + voided + failed > 50) {
      throw new Error("Invalid reward worker result");
    }
    return NextResponse.json({ ok: failed === 0, applied, voided, failed, remaining }, { status: failed ? 503 : 200 });
  } catch {
    return NextResponse.json({ ok: false, error: "Reward retry requires investigation" }, { status: 503 });
  }
}
