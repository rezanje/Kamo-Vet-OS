"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { cekPeriode } from "@/lib/jurnal-guard";
import { jurnalPelepasan, jurnalTambahNilai, nilaiBuku } from "@/lib/aset";

const BOLEH = ["OWNER", "ADMIN", "FINANCE"];
const back = (id: string) => `/keuangan/aset/${id}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

async function muatAset(supabase: Db, id: string) {
  const { data } = await supabase
    .from("fixed_assets")
    .select("id, nama, tanggal_perolehan, harga_perolehan, nilai_sisa, umur_bulan, branch_id, status, is_active")
    .eq("id", id).maybeSingle();
  return data as {
    id: string; nama: string; tanggal_perolehan: string; harga_perolehan: number;
    nilai_sisa: number; umur_bulan: number; branch_id: string | null; status: string; is_active: boolean;
  } | null;
}

async function akumulasiAset(supabase: Db, id: string): Promise<number> {
  const { data } = await supabase.from("asset_depreciations").select("amount").eq("asset_id", id);
  return ((data ?? []) as { amount: number }[]).reduce((a, d) => a + Number(d.amount), 0);
}

/** Tetapkan golongan pajak aset — dasar penyusutan fiskal, tidak menyentuh jurnal. */
export async function setGolonganPajak(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const gagal = (msg: string): never => redirect(`${back(id)}?error=${encodeURIComponent(msg)}`);
  const supabase = await assertRole(back(id), "golongan pajak aset", BOLEH);
  if (!id) gagal("Aset tidak valid");

  const taxId = String(formData.get("tax_category_id") ?? "").trim() || null;
  const { error } = await supabase.from("fixed_assets").update({ tax_category_id: taxId }).eq("id", id);
  if (error) gagal(error.message);

  redirect(`${back(id)}?success=${encodeURIComponent("Golongan pajak tersimpan.")}`);
}

/**
 * Perbaikan besar yang menambah nilai perolehan.
 * Bedanya dengan beban perawatan (5304): ini menambah manfaat aset, jadi ikut
 * disusutkan, bukan langsung dibebankan habis di bulan itu.
 */
export async function tambahNilaiAset(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const gagal = (msg: string): never => redirect(`${back(id)}?error=${encodeURIComponent(msg)}`);
  const supabase = await assertRole(back(id), "perubahan aset tetap", BOLEH);

  const tambahan = Number(formData.get("tambahan")) || 0;
  const tanggal = String(formData.get("tanggal") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const metode = String(formData.get("metode") ?? "Transfer");
  const accountId = String(formData.get("account_id") ?? "").trim() || null;
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;

  const aset = await muatAset(supabase, id);
  if (!aset) gagal("Aset tidak ditemukan");
  if (aset!.status === "dilepas") gagal("Aset ini sudah dilepas");
  if (tambahan <= 0) gagal("Nilai tambahan harus lebih dari 0");

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  const lama = Number(aset!.harga_perolehan);
  const baru = lama + tambahan;

  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("asset_changes").insert({
    asset_id: id, tanggal, jenis: "nilai", nilai_lama: lama, nilai_baru: baru,
    keterangan, created_by: user?.id ?? null,
  });
  await supabase.from("fixed_assets").update({ harga_perolehan: baru }).eq("id", id);

  const kasCode = await kodeAkunBayar(supabase, metode, aset!.branch_id, accountId);
  await postJournal(supabase, {
    tanggal,
    deskripsi: `Penambahan nilai aset: ${aset!.nama}`,
    source: "asset-change",
    sourceRef: id,
    branchId: aset!.branch_id,
    lines: jurnalTambahNilai(tambahan, kasCode),
  });

  redirect(`${back(id)}?success=${encodeURIComponent("Nilai aset bertambah — penyusutan berikutnya ikut menyesuaikan.")}`);
}

/** Revisi taksiran umur ekonomis. Tanpa jurnal — yang berubah cuma penyusutan ke depan. */
export async function ubahUmurAset(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const gagal = (msg: string): never => redirect(`${back(id)}?error=${encodeURIComponent(msg)}`);
  const supabase = await assertRole(back(id), "perubahan aset tetap", BOLEH);

  const umurBaru = Number(formData.get("umur_bulan")) || 0;
  const tanggal = String(formData.get("tanggal") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;

  const aset = await muatAset(supabase, id);
  if (!aset) gagal("Aset tidak ditemukan");
  if (aset!.status === "dilepas") gagal("Aset ini sudah dilepas");
  if (umurBaru <= 0) gagal("Umur ekonomis harus lebih dari 0 bulan");
  if (umurBaru === aset!.umur_bulan) gagal("Umur ekonomisnya sama dengan yang sekarang");

  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("asset_changes").insert({
    asset_id: id, tanggal, jenis: "umur", umur_lama: aset!.umur_bulan, umur_baru: umurBaru,
    keterangan, created_by: user?.id ?? null,
  });
  await supabase.from("fixed_assets").update({ umur_bulan: umurBaru }).eq("id", id);

  redirect(`${back(id)}?success=${encodeURIComponent("Umur ekonomis diperbarui.")}`);
}

/** Jual atau hapus aset. Penyusutan berhenti dan akumulasinya ikut dihapus dari neraca. */
export async function disposisiAset(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const gagal = (msg: string): never => redirect(`${back(id)}?error=${encodeURIComponent(msg)}`);
  const supabase = await assertRole(back(id), "disposisi aset tetap", BOLEH);

  const jenis = String(formData.get("jenis") ?? "jual").trim();
  const hargaJual = jenis === "jual" ? Number(formData.get("harga_jual")) || 0 : 0;
  const tanggal = String(formData.get("tanggal") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const metode = String(formData.get("metode") ?? "Transfer");
  const accountId = String(formData.get("account_id") ?? "").trim() || null;
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;

  const aset = await muatAset(supabase, id);
  if (!aset) gagal("Aset tidak ditemukan");
  if (aset!.status === "dilepas") gagal("Aset ini sudah dilepas");
  if (jenis !== "jual" && jenis !== "hapus") gagal("Jenis disposisi tidak dikenal");
  if (jenis === "jual" && hargaJual <= 0) gagal("Isi harga jualnya, atau pilih hapus kalau tidak ada hasil penjualan");

  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  const harga = Number(aset!.harga_perolehan);
  const akumulasi = Math.min(harga, await akumulasiAset(supabase, id));
  const buku = nilaiBuku(harga, akumulasi);
  const labaRugi = hargaJual - buku;

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("asset_disposals").insert({
    asset_id: id, tanggal, jenis, harga_jual: hargaJual, metode, account_id: accountId,
    harga_perolehan: harga, akumulasi, nilai_buku: buku, laba_rugi: labaRugi,
    keterangan, created_by: user?.id ?? null,
  });
  if (error) gagal(error.message);

  const kasCode = await kodeAkunBayar(supabase, metode, aset!.branch_id, accountId);
  await postJournal(supabase, {
    tanggal,
    deskripsi: `${jenis === "jual" ? "Penjualan" : "Penghapusan"} aset tetap: ${aset!.nama}`,
    source: "asset-disposal",
    sourceRef: id,
    branchId: aset!.branch_id,
    lines: jurnalPelepasan(harga, akumulasi, hargaJual, kasCode),
  });

  // is_active ikut dimatikan supaya mesin penyusutan berhenti menyusutkannya.
  await supabase.from("fixed_assets").update({ status: "dilepas", is_active: false }).eq("id", id);

  redirect(`${back(id)}?success=${encodeURIComponent(
    labaRugi >= 0
      ? `Aset dilepas dengan laba Rp ${Math.round(labaRugi).toLocaleString("id-ID")}.`
      : `Aset dilepas dengan rugi Rp ${Math.round(-labaRugi).toLocaleString("id-ID")}.`,
  )}`);
}

/** Pindah cabang. Tanpa jurnal: perusahaannya sama, yang pindah lokasi & tanggung jawab. */
export async function pindahAset(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const gagal = (msg: string): never => redirect(`${back(id)}?error=${encodeURIComponent(msg)}`);
  const supabase = await assertRole(back(id), "pindah aset", BOLEH);

  const keBranch = String(formData.get("ke_branch_id") ?? "").trim();
  const tanggal = String(formData.get("tanggal") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const keterangan = String(formData.get("keterangan") ?? "").trim() || null;

  const aset = await muatAset(supabase, id);
  if (!aset) gagal("Aset tidak ditemukan");
  if (aset!.status === "dilepas") gagal("Aset ini sudah dilepas");
  if (!keBranch) gagal("Pilih cabang tujuan");
  if (keBranch === aset!.branch_id) gagal("Aset sudah berada di cabang itu");

  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("asset_transfers").insert({
    asset_id: id, tanggal, dari_branch_id: aset!.branch_id, ke_branch_id: keBranch,
    keterangan, created_by: user?.id ?? null,
  });
  await supabase.from("fixed_assets").update({ branch_id: keBranch }).eq("id", id);

  redirect(`${back(id)}?success=${encodeURIComponent("Aset dipindahkan.")}`);
}
