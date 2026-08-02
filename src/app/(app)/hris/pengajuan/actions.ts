"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { AKUN_PIUTANG_KARYAWAN } from "@/lib/kasbon";
import { cekPeriode, jurnalTersimpan } from "@/lib/jurnal-guard";
import { hariIniWIB } from "@/lib/followup";

const BACK = "/hris/pengajuan";
const BOLEH = ["OWNER", "ADMIN"];
const gagal = (msg: string): never => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

// Nama/value tombol submit TIDAK ikut terkirim ke server action (sudah diuji:
// FormData cuma berisi field form). Karena itu setuju & tolak jadi dua action
// terpisah, bukan satu action yang membaca tombol mana yang ditekan.

async function stempel(supabase: Awaited<ReturnType<typeof assertRole>>, status: string, formData: FormData) {
  const { data: { user } } = await supabase.auth.getUser();
  return {
    status,
    catatan_penyetuju: String(formData.get("catatan") ?? "").trim() || null,
    approved_by: user?.id ?? null,
    approved_at: new Date().toISOString(),
  };
}

async function putuskan(tabel: string, status: string, formData: FormData, sukses: string) {
  const supabase = await assertRole(BACK, "pengajuan karyawan", BOLEH);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) gagal("Pengajuan tidak valid");

  const { error } = await supabase.from(tabel)
    .update(await stempel(supabase, status, formData))
    .eq("id", id).eq("status", "Menunggu");
  if (error) gagal(error.message);
  redirect(`${BACK}?success=${sukses}`);
}

export async function setujuiLembur(formData: FormData) {
  await putuskan("overtime_requests", "Disetujui", formData, "lembur");
}

export async function tolakLembur(formData: FormData) {
  await putuskan("overtime_requests", "Ditolak", formData, "lembur");
}

export async function setujuiReimburse(formData: FormData) {
  await putuskan("reimbursements", "Disetujui", formData, "reimburse");
}

export async function tolakReimburse(formData: FormData) {
  await putuskan("reimbursements", "Ditolak", formData, "reimburse");
}

export async function tolakKasbon(formData: FormData) {
  await putuskan("cash_advances", "Ditolak", formData, "kasbon");
}

// Kasbon disetujui = uangnya cair saat itu juga: Dr Piutang Karyawan / Cr rekening.
// Tenor boleh diubah penyetuju — dia yang tahu kemampuan bayar karyawannya.
export async function setujuiKasbon(formData: FormData) {
  const supabase = await assertRole(BACK, "pengajuan kasbon", BOLEH);

  const id = String(formData.get("id") ?? "").trim();
  if (!id) gagal("Pengajuan tidak valid");

  const { data: kasbon } = await supabase
    .from("cash_advances")
    .select("id, jumlah, status, employee_id, employees(nama, branch_id)")
    .eq("id", id).maybeSingle();
  if (!kasbon) gagal("Kasbon tidak ditemukan");
  if (kasbon!.status !== "Menunggu") gagal("Kasbon ini sudah diputuskan");

  const tenor = Math.floor(Number(formData.get("tenor_bulan")) || 1);
  if (tenor < 1 || tenor > 24) gagal("Lama cicilan antara 1 sampai 24 bulan");

  const accountId = String(formData.get("account_id") ?? "").trim() || null;
  const tanggal = hariIniWIB();
  const pesanPeriode = await cekPeriode(supabase, tanggal);
  if (pesanPeriode) gagal(pesanPeriode);

  const emp = (Array.isArray(kasbon!.employees) ? kasbon!.employees[0] : kasbon!.employees) as
    { nama: string; branch_id: string | null } | null;

  // Predikat status ada di UPDATE-nya sendiri supaya klik dobel tidak mencairkan dua kali.
  const { data: updated } = await supabase.from("cash_advances")
    .update({
      ...(await stempel(supabase, "Disetujui", formData)),
      tenor_bulan: tenor,
      disbursed_at: new Date().toISOString(),
      cash_account_id: accountId,
    })
    .eq("id", id).eq("status", "Menunggu").select("id");
  if (!updated || updated.length === 0) gagal("Kasbon ini sudah diputuskan");

  const ref = `KSB-${String(id).slice(0, 8)}`;
  const kasCode = await kodeAkunBayar(supabase, "Transfer", emp?.branch_id ?? null, accountId);
  const jumlah = Number(kasbon!.jumlah);

  await postJournal(supabase, {
    tanggal,
    deskripsi: `Kasbon ${emp?.nama ?? "karyawan"}`,
    source: "kasbon",
    sourceRef: ref,
    branchId: emp?.branch_id ?? null,
    lines: [
      { code: AKUN_PIUTANG_KARYAWAN, debit: jumlah, credit: 0 },
      { code: kasCode, debit: 0, credit: jumlah },
    ],
  });

  // Uang keluar di layar tapi tidak di pembukuan lebih buruk daripada gagal.
  if (!(await jurnalTersimpan(supabase, "kasbon", ref))) {
    await supabase.from("cash_advances")
      .update({ status: "Menunggu", disbursed_at: null, approved_at: null, approved_by: null })
      .eq("id", id);
    gagal("Jurnal kasbon gagal tersimpan, pencairan dibatalkan — coba lagi");
  }

  redirect(`${BACK}?success=kasbon`);
}
