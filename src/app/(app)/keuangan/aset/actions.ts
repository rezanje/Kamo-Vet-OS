"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { periodeBelumSelesai, runDepreciationPeriod } from "@/lib/depreciation";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";
import { assetPurchaseJournal, assertNewAssetFunding } from "@/lib/asset-acquisition";

const back = "/keuangan/aset";

type AssetInput = {
  nama: string; categoryId: string; tanggal: string; harga: number;
  nilaiSisa: number; umurBulan: number; branchId: string | null; kategori: string;
};

async function bacaAset(
  supabase: Awaited<ReturnType<typeof createClient>>,
  formData: FormData,
): Promise<AssetInput> {
  const nama = String(formData.get("nama") ?? "").trim();
  const categoryId = String(formData.get("category_id") ?? "").trim();
  const tanggal = String(formData.get("tanggal") ?? "") || hariIniWIB();
  const harga = Number(formData.get("harga")) || 0;
  const nilaiSisa = Number(formData.get("nilai_sisa")) || 0;
  const umurBulan = Number(formData.get("umur_bulan")) || 0;
  const branchId = String(formData.get("branch_id") ?? "").trim() || null;

  if (!nama || !categoryId || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)
    || !Number.isFinite(harga) || harga <= 0 || !Number.isFinite(umurBulan) || umurBulan <= 0) {
    redirect(`${back}?error=${encodeURIComponent("Nama, kategori, tanggal, harga perolehan, dan umur ekonomis wajib diisi dengan benar")}`);
  }
  if (!Number.isFinite(nilaiSisa) || nilaiSisa < 0 || nilaiSisa >= harga) {
    redirect(`${back}?error=${encodeURIComponent("Nilai sisa harus nol atau lebih, dan lebih kecil dari harga perolehan")}`);
  }

  const { data: kat, error } = await supabase.from("asset_categories")
    .select("nama").eq("id", categoryId).eq("is_active", true).maybeSingle();
  if (error || !kat) redirect(`${back}?error=${encodeURIComponent("Kategori aset tidak valid")}`);
  return { nama, categoryId, tanggal, harga, nilaiSisa, umurBulan, branchId, kategori: String(kat.nama) };
}

export async function tambahSaldoAwalAset(formData: FormData) {
  const supabase = await createClient();
  const a = await bacaAset(supabase, formData);
  const pesanPeriode = await cekPeriode(supabase, a.tanggal);
  if (pesanPeriode) redirect(`${back}?error=${encodeURIComponent(pesanPeriode)}`);
  const { error } = await supabase.from("fixed_assets").insert({
    nama: a.nama, kategori: a.kategori, category_id: a.categoryId,
    tanggal_perolehan: a.tanggal, harga_perolehan: a.harga, nilai_sisa: a.nilaiSisa,
    umur_bulan: a.umurBulan, branch_id: a.branchId,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  redirect(`${back}?success=saldo-awal`);
}

export async function tambahPembelianAset(formData: FormData) {
  const supabase = await createClient();
  const a = await bacaAset(supabase, formData);
  const sumber = String(formData.get("sumber") ?? "").trim();
  try {
    assertNewAssetFunding(sumber);
  } catch (e) {
    redirect(`${back}?error=${encodeURIComponent(e instanceof Error ? e.message : "Sumber dana tidak valid")}`);
  }

  const pesanPeriode = await cekPeriode(supabase, a.tanggal);
  if (pesanPeriode) redirect(`${back}?error=${encodeURIComponent(pesanPeriode)}`);
  const creditCode = await kodeAkunBayar(
    supabase,
    sumber,
    a.branchId,
    String(formData.get("account_id") ?? "").trim() || null,
  );
  let journal: ReturnType<typeof assetPurchaseJournal>;
  try {
    journal = assetPurchaseJournal(a.harga, sumber, creditCode);
  } catch (e) {
    redirect(`${back}?error=${encodeURIComponent(e instanceof Error ? e.message : "Data pembelian tidak valid")}`);
  }

  const creditAccount = journal.find((line) => line.credit > 0)?.code;
  if (!creditAccount) redirect(`${back}?error=${encodeURIComponent("Akun pembelian aset tidak valid")}`);
  const { data, error } = await supabase.rpc("create_fixed_asset_purchase", {
    p_nama: a.nama,
    p_category_id: a.categoryId,
    p_tanggal: a.tanggal,
    p_harga: a.harga,
    p_nilai_sisa: a.nilaiSisa,
    p_umur_bulan: a.umurBulan,
    p_branch_id: a.branchId,
    p_funding: sumber,
    p_credit_code: creditAccount,
  });
  if (error || !data) {
    redirect(`${back}?error=${encodeURIComponent(`Pembelian dan jurnal dibatalkan: ${error?.message ?? "gagal"}`)}`);
  }
  redirect(`${back}?success=pembelian`);
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
