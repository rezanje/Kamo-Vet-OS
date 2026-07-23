// Cron bulanan Vercel: penyusutan aset otomatis (vercel.json crons → tiap tanggal 1).
// Butuh env: CRON_SECRET (dikirim Vercel sebagai Authorization: Bearer <secret>)
// + SUPABASE_SERVICE_ROLE_KEY (akses DB tanpa sesi login; RLS di-bypass).
// Tanpa env tsb route menolak — lazy catch-up di halaman Aset tetap jadi jaring pengaman.

import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { catchUpDepreciation } from "@/lib/depreciation";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY belum diset — penyusutan tetap jalan via halaman Aset" },
      { status: 501 },
    );
  }

  const supabase = createServiceClient(url, serviceKey, { auth: { persistSession: false } });
  const runs = await catchUpDepreciation(supabase);
  return NextResponse.json({
    ok: true,
    periods: runs.map((r) => ({ periode: r.periode, total: r.total, aset: r.jumlahAset })),
  });
}
