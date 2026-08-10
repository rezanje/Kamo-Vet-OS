"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { cekPeriode, jurnalTersimpan } from "@/lib/jurnal-guard";
import { kodeAkunBerikutnya, AKUN_MODAL } from "@/lib/transfer-kas";
import { hariIniWIB } from "@/lib/tanggal";
import { postJournal } from "@/lib/posting";

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
  const saldoAwal = Number(formData.get("saldo_awal")) || 0;

  if (!nama) gagal("Nama rekening wajib diisi");
  if (jenis !== "Kas" && jenis !== "Bank") gagal("Jenis rekening harus Kas atau Bank");
  if (!Number.isFinite(saldoAwal) || saldoAwal < 0) gagal("Saldo awal tidak boleh negatif");

  const tanggal = hariIniWIB();

  // Periode dicek DULU supaya tidak perlu rollback akun COA yang terlanjur lahir.
  if (saldoAwal > 0) {
    const pesan = await cekPeriode(supabase, tanggal);
    if (pesan) gagal(pesan);
  }

  const { data: akunAda } = await supabase.from("coa_accounts").select("code");
  const kode = kodeAkunBerikutnya((akunAda ?? []).map((a: { code: string }) => a.code));
  if (!kode) gagal("Nomor akun kas/bank sudah penuh (1103–1199) — hubungi developer");

  const { error: akunErr } = await supabase.from("coa_accounts").insert({
    code: kode, name: nama, type: "ASET", normal_balance: "D", is_active: true,
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
    await postJournal(supabase, {
      tanggal,
      deskripsi: `Saldo awal rekening ${nama}`,
      source: "cash-account-opening",
      sourceRef: kode,
      branchId,
      lines: [
        { code: kode!, debit: saldoAwal, credit: 0 },
        { code: AKUN_MODAL, debit: 0, credit: saldoAwal },
      ],
    });

    // postJournal tidak pernah melempar — saldo awal tanpa jurnal = saldo hantu.
    if (!(await jurnalTersimpan(supabase, "cash-account-opening", kode!))) {
      await supabase.from("cash_accounts").delete().eq("id", rek!.id);
      await supabase.from("coa_accounts").delete().eq("code", kode);
      gagal("Jurnal saldo awal gagal tersimpan, rekening dibatalkan — coba lagi");
    }
  }

  redirect(`${BACK}?success=1`);
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
