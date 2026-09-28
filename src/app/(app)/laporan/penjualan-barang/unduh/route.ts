import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bolehBukaPath } from "@/lib/akses";
import { reportCsv } from "@/lib/csv-report";
import { hariIniWIB } from "@/lib/tanggal";
import { ambilPenjualanBarang, waktuWIB } from "../data";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 401 });
  const [{ data: profile, error: profileError }, { data: aturan, error: aturanError }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase.from("role_modules").select("role, module_id"),
  ]);
  if (profileError || aturanError || !profile?.role || !bolehBukaPath(profile.role, "/laporan/penjualan-barang", aturan ?? [])) {
    return NextResponse.json({ error: "Akses laporan tidak diizinkan" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const hariIni = hariIniWIB();
  const dari = params.get("dari") || `${hariIni.slice(0, 8)}01`;
  const sampai = params.get("sampai") || hariIni;
  const kanalInput = params.get("kanal");
  const kanal = kanalInput === "POS" || kanalInput === "Online" ? kanalInput : "Klinik";
  const jenisInput = params.get("jenis");
  const jenis = kanal === "Klinik" && ["Obat", "Jasa", "Racikan"].includes(jenisInput ?? "") ? jenisInput! : kanal === "Klinik" ? "Racikan" : "Barang";
  const q = (params.get("q") ?? "").trim().slice(0, 120);
  const { rows, pesanError } = await ambilPenjualanBarang({ dari, sampai, kanal, jenis, q });
  if (pesanError) return NextResponse.json({ error: pesanError }, { status: 400 });

  const csv = reportCsv(
    ["Waktu WIB", "No. dokumen", "Sumber", "Jenis", "Cabang", "Pelanggan", "Pasien", "Barang / layanan", "Qty", "Harga", "Diskon item", "Nilai baris", "Status"],
    rows.map((row) => [waktuWIB(row.waktu), row.dokumen, row.kanal, row.jenis, row.cabang, row.pelanggan, row.hewan, row.nama, row.qty, row.harga, row.diskon, row.nilai, row.status]),
  );
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="penjualan-barang-${dari}-${sampai}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
