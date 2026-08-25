// Cron bulanan Vercel: proses akhir bulan (vercel.json crons → tiap tanggal 1).
//
// Menggantikan cron penyusutan lama — pekerjaannya sekarang tiga: posting penyusutan,
// posting jurnal berulang, dan (kalau dinyalakan) mengunci bulan yang sudah lewat.
//
// Butuh env: CRON_SECRET (dikirim Vercel sebagai Authorization: Bearer <secret>)
// + SUPABASE_SERVICE_ROLE_KEY (akses DB tanpa sesi login; RLS di-bypass).
// Tanpa env tsb route menolak — tombol "Jalankan sekarang" di layar Tutup Buku
// dan catch-up di halaman Aset tetap jadi jaring pengamannya.

import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { jalankanAkhirBulan } from "@/lib/akhir-bulan-server";
import { ringkasHasil } from "@/lib/akhir-bulan";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY belum diset — proses akhir bulan tetap bisa ditekan manual di layar Tutup Buku" },
      { status: 501 },
    );
  }

  const supabase = createServiceClient(url, serviceKey, { auth: { persistSession: false } });
  const hasil = await jalankanAkhirBulan(supabase, { sumber: "cron" });
  return NextResponse.json({ ok: true, periode: hasil.periode, ringkasan: ringkasHasil(hasil), hasil });
}
