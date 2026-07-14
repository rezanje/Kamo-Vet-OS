"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { depreciationPerMonth, monthsElapsed } from "@/lib/aging";

const back = "/keuangan/aset";

// Catat aset tetap baru. Sumber dana Kas/Bank → jurnal Dr Aset Tetap / Cr Kas;
// "saldo-awal" → tanpa jurnal (aset sudah ada sebelum sistem dipakai).
export async function tambahAset(formData: FormData) {
  const supabase = await createClient();

  const nama = String(formData.get("nama") ?? "").trim();
  const kategori = String(formData.get("kategori") ?? "Peralatan");
  const tanggal = String(formData.get("tanggal") ?? "") || new Date().toISOString().slice(0, 10);
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

  const { error } = await supabase.from("fixed_assets").insert({
    nama, kategori, tanggal_perolehan: tanggal, harga_perolehan: harga,
    nilai_sisa: nilaiSisa, umur_bulan: umurBulan, branch_id: branchId,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);

  if (sumber !== "saldo-awal") {
    const kasCode = sumber === "Tunai" ? "1101" : "1102";
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
// Idempotent: unique(asset_id, periode) menolak dobel-jalan per aset.
export async function jalankanPenyusutan(formData: FormData) {
  const supabase = await createClient();
  const periode = String(formData.get("periode") ?? "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(periode)) {
    redirect(`${back}?error=${encodeURIComponent("Periode tidak valid")}`);
  }

  const { data: assets } = await supabase
    .from("fixed_assets")
    .select("id, nama, tanggal_perolehan, harga_perolehan, nilai_sisa, umur_bulan")
    .eq("is_active", true);

  const { data: deps } = await supabase.from("asset_depreciations").select("asset_id, amount");
  const depSum = new Map<string, number>();
  for (const d of deps ?? []) depSum.set(d.asset_id, (depSum.get(d.asset_id) ?? 0) + Number(d.amount));

  let total = 0;
  let jumlahAset = 0;
  for (const a of assets ?? []) {
    const bulan = monthsElapsed(a.tanggal_perolehan, periode);
    if (bulan < 1 || bulan > a.umur_bulan) continue; // belum mulai / sudah habis umur

    const perBulan = depreciationPerMonth(Number(a.harga_perolehan), Number(a.nilai_sisa), a.umur_bulan);
    const sisaDisusutkan = Math.max(0, Number(a.harga_perolehan) - Number(a.nilai_sisa) - (depSum.get(a.id) ?? 0));
    const amount = Math.min(perBulan, sisaDisusutkan);
    if (amount <= 0) continue;

    // insert per aset; kalau sudah pernah jalan utk periode ini, unique constraint menolak → skip.
    const { error } = await supabase.from("asset_depreciations").insert({ asset_id: a.id, periode, amount });
    if (error) continue;
    total += amount;
    jumlahAset += 1;
  }

  if (total > 0) {
    await postJournal(supabase, {
      tanggal: `${periode}-28`,
      deskripsi: `Penyusutan aset tetap periode ${periode} (${jumlahAset} aset)`,
      source: "depreciation",
      sourceRef: periode,
      branchId: null,
      lines: [
        { code: "5601", debit: total, credit: 0 },
        { code: "1509", debit: 0, credit: total },
      ],
    });
    redirect(`${back}?success=susut&n=${jumlahAset}`);
  }
  redirect(`${back}?error=${encodeURIComponent("Tidak ada aset yang perlu disusutkan untuk periode ini (mungkin sudah dijalankan)")}`);
}
