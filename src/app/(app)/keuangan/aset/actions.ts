"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { periodeBelumSelesai, runDepreciationPeriod } from "@/lib/depreciation";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";

const back = "/keuangan/aset";

// Catat aset tetap baru. Sumber dana Kas/Bank → jurnal Dr Aset Tetap / Cr Kas;
// "saldo-awal" → tanpa jurnal (aset sudah ada sebelum sistem dipakai).
export async function tambahAset(formData: FormData) {
  const supabase = await createClient();

  const nama = String(formData.get("nama") ?? "").trim();
  const categoryId = String(formData.get("category_id") ?? "").trim() || null;
  const tanggal = String(formData.get("tanggal") ?? "") || hariIniWIB();
  const harga = Number(formData.get("harga")) || 0;
  const nilaiSisa = Number(formData.get("nilai_sisa")) || 0;
  const umurBulan = Number(formData.get("umur_bulan")) || 0;
  const sumber = String(formData.get("sumber") ?? "saldo-awal"); // Tunai / Bank / saldo-awal
  const branchId = String(formData.get("branch_id") ?? "").trim() || null;

  if (!nama || harga <= 0 || umurBulan <= 0) {
    redirect(`${back}?error=${encodeURIComponent("Nama, harga perolehan, dan umur ekonomis wajib diisi")}`);
  }
  if (nilaiSisa >= harga) {
    redirect(`${back}?error=${encodeURIComponent("Nilai sisa harus lebih kecil dari harga perolehan")}`);
  }

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) redirect(`${back}?error=${encodeURIComponent(pesanPeriode)}`);

  // fixed_assets.kategori (teks) tetap diisi sebagai jejak historis; sumber
  // kebenarannya sekarang category_id.
  let kategori = "Peralatan";
  if (categoryId) {
    const { data: kat } = await supabase.from("asset_categories").select("nama").eq("id", categoryId).maybeSingle();
    if (!kat) redirect(`${back}?error=${encodeURIComponent("Kategori aset tidak valid")}`);
    kategori = kat.nama as string;
  }

  const { error } = await supabase.from("fixed_assets").insert({
    nama, kategori, category_id: categoryId, tanggal_perolehan: tanggal, harga_perolehan: harga,
    nilai_sisa: nilaiSisa, umur_bulan: umurBulan, branch_id: branchId,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);

  if (sumber !== "saldo-awal") {
    const kasCode = await kodeAkunBayar(supabase, sumber, branchId, String(formData.get("account_id") ?? "").trim() || null);
    await postJournal(supabase, {
      tanggal,
      deskripsi: `Pembelian aset tetap: ${nama}`,
      source: "asset",
      sourceRef: null,
      branchId,
      lines: [
        { code: "1501", debit: harga, credit: 0 },
        { code: kasCode, debit: 0, credit: harga },
      ],
    });
  }

  redirect(`${back}?success=aset`);
}

// Jalankan penyusutan garis lurus untuk satu periode (YYYY-MM).
// Mesin di lib/depreciation.ts (idempotent) — dipakai juga oleh catch-up & cron.
export async function jalankanPenyusutan(formData: FormData) {
  const supabase = await createClient();
  const periode = String(formData.get("periode") ?? "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(periode)) {
    redirect(`${back}?error=${encodeURIComponent("Periode tidak valid")}`);
  }
  if (periodeBelumSelesai(periode, hariIniWIB())) {
    redirect(`${back}?error=${encodeURIComponent("Bulan ini belum selesai — penyusutan baru bisa dijalankan setelah bulannya lewat.")}`);
  }

  const { total, jumlahAset } = await runDepreciationPeriod(supabase, periode);
  if (total > 0) redirect(`${back}?success=susut&n=${jumlahAset}`);
  redirect(`${back}?error=${encodeURIComponent("Tidak ada aset yang perlu disusutkan untuk periode ini (mungkin sudah dijalankan)")}`);
}
