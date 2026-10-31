"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { cekPeriode } from "@/lib/jurnal-guard";
import { kodeAkunBerikutnya } from "@/lib/transfer-kas";
import { KODE_REKENING } from "@/lib/coa-sistem";
import { isApprovedBranchCashPair } from "@/lib/branch-cash-config";
import { hariIniWIB } from "@/lib/tanggal";

const BACK = "/kas-bank/rekening";
// Tipe ditulis di variabelnya (bukan cuma di arrow) supaya TypeScript memakai
// `never` untuk mempersempit tipe sesudah pemanggilan.
const gagal: (msg: string) => never = (msg) => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

export async function tambahRekening(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "daftar rekening");

  const nama = String(formData.get("nama") ?? "").trim().slice(0, 80);
  const jenis = String(formData.get("jenis") ?? "").trim();
  const bankNama = String(formData.get("bank_nama") ?? "").trim().slice(0, 60) || null;
  const noRekening = String(formData.get("no_rekening") ?? "").trim().slice(0, 40) || null;
  const branchId = String(formData.get("branch_id") ?? "").trim() || null;
  const saldoAwal = Number(formData.get("saldo_awal") ?? 0);

  if (!nama) gagal("Nama rekening wajib diisi");
  if (jenis !== "Kas" && jenis !== "Bank") gagal("Jenis rekening harus Kas atau Bank");
  if (!Number.isFinite(saldoAwal) || saldoAwal < 0 || saldoAwal > 1_000_000_000_000 || Number(saldoAwal.toFixed(2)) !== saldoAwal) {
    gagal("Saldo awal harus angka rupiah dari 0 sampai 1 triliun, maksimal dua desimal");
  }

  const tanggal = hariIniWIB();

  // Periode dicek DULU supaya tidak perlu rollback akun COA yang terlanjur lahir.
  if (saldoAwal > 0) {
    const pesan = await cekPeriode(supabase, tanggal);
    if (pesan) gagal(pesan);
  }

  const { data: akunAda } = await supabase.from("coa_accounts").select("code");
  const kode = kodeAkunBerikutnya((akunAda ?? []).map((a: { code: string }) => a.code), jenis as "Kas" | "Bank");
  if (!kode) gagal(`Nomor akun ${jenis.toLowerCase()} sudah penuh (${KODE_REKENING[jenis as "Kas" | "Bank"].min}–${KODE_REKENING[jenis as "Kas" | "Bank"].max}) — hubungi developer`);

  // Rekening baru masuk di bawah induk Kas (110000) / Bank (120000) bagan akun bila ada.
  const { data: induk } = await supabase.from("coa_accounts").select("id")
    .eq("code", jenis === "Bank" ? "120000" : "110000").eq("is_header", true).maybeSingle();
  const { error: akunErr } = await supabase.from("coa_accounts").insert({
    code: kode, name: nama, type: "ASET", normal_balance: "D", is_active: true, parent_id: induk?.id ?? null,
  });
  if (akunErr) gagal("Gagal membuat akun untuk rekening ini, coba lagi");

  const { data: rek, error: rekErr } = await supabase.from("cash_accounts").insert({
    nama, jenis, coa_code: kode,
    bank_nama: jenis === "Bank" ? bankNama : null,
    no_rekening: jenis === "Bank" ? noRekening : null,
    branch_id: branchId,
  }).select("id").maybeSingle();

  if (rekErr || !rek) {
    // Akun COA yatim tidak boleh tertinggal di daftar akun.
    await supabase.from("coa_accounts").delete().eq("code", kode);
    gagal("Gagal menyimpan rekening, coba lagi");
  }

  if (saldoAwal > 0) {
    const { data, error } = await supabase.rpc("post_cash_account_opening_atomic", {
      p_account_id: rek.id, p_amount: saldoAwal,
    });
    if (error || !data?.entry_id) {
      // A network timeout may hide a committed posting. Keep the account mapping
      // and its journal intact so the Owner can inspect/correct its opening.
      gagal("Rekening tersimpan, saldo awal belum terkonfirmasi. Periksa buku mutasi sebelum mencoba koreksi saldo awal.");
    }
  }

  redirect(`${BACK}?success=1`);
}

// Links a posted COA cash detail to the operational cash menu. Its existing
// journal balance stays on the same COA ID; no opening journal is created.
export async function hubungkanKasCabang(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "hubungkan kas cabang");
  const branchId = String(formData.get("branch_id") ?? "").trim();
  const code = String(formData.get("coa_code") ?? "").trim();
  if (!branchId || !/^110[0-9]{3}$/.test(code) || ["110001", "110002", "110003"].includes(code)) {
    gagal("Akun kas cabang dan cabang wajib dipilih");
  }
  const [{ data: branch, error: branchError }, { data: account, error: accountError }] = await Promise.all([
    supabase.from("branches").select("id,code,type,is_active").eq("id", branchId).eq("is_active", true).maybeSingle(),
    supabase.from("coa_accounts").select("code,name,type,is_active,is_header").eq("code", code).maybeSingle(),
  ]);
  if (branchError || !branch || !["PETSHOP", "KLINIK"].includes(branch.type)) gagal("Cabang kas tidak tersedia");
  if (accountError || !account || account.type !== "ASET" || !account.is_active || account.is_header
    || !/^Kas Toko\b/i.test(account.name)) gagal("Akun kas rincian aktif tidak tersedia");
  if ((branch.type === "KLINIK") !== /^Kas Toko Vet\b/i.test(account.name)) gagal("Jenis akun kas tidak sesuai jenis cabang");
  if (!isApprovedBranchCashPair(code, branch.code)) gagal("Akun kas toko tidak sesuai cabang yang disetujui");

  const { error } = await supabase.from("cash_accounts").insert({
    nama: account.name, jenis: "Kas", coa_code: code, branch_id: branchId, is_active: true,
  });
  if (error) gagal(error.code === "23505" ? "Akun kas ini sudah menjadi rekening" : "Akun kas belum dapat dihubungkan");
  redirect(`${BACK}?success=kas-cabang`);
}

// Rekening tidak dihapus: akun COA-nya sudah dipakai jurnal. Nonaktif = tidak
// muncul di dropdown transfer, saldonya tetap tampil (uangnya masih ada).
// Akun COA-nya SENGAJA dibiarkan aktif supaya buku besar & neraca tetap membacanya.
export async function toggleRekening(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "daftar rekening");
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) gagal("Rekening tidak valid");

  const { error } = await supabase.from("cash_accounts").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}
