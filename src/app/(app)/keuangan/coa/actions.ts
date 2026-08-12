"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertMasterAdmin } from "@/lib/master-guard";
import { pesanSimpanGagal } from "@/lib/barang";
import {
  alasanTakBolehNonaktif, validasiAkunBaru, validasiUbahAkun,
  type PemakaiAkun,
} from "@/lib/coa-sistem";

const BACK = "/keuangan/coa";
const gagal: (msg: string) => never = (msg) => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

export async function simpanAkun(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "bagan akun");

  const id = String(formData.get("id") ?? "").trim();
  const draft = {
    code: String(formData.get("code") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim().slice(0, 80),
    type: String(formData.get("type") ?? "").trim().toUpperCase(),
    normal_balance: String(formData.get("normal_balance") ?? "").trim().toUpperCase(),
  };

  if (id) {
    const { data: lama } = await supabase
      .from("coa_accounts").select("code, type, normal_balance").eq("id", id).maybeSingle();
    if (!lama) gagal("Akun tidak ditemukan.");

    // Akun yang sudah punya jurnal tidak boleh berganti kelompok/saldo normal:
    // saldo dihitung dari normal_balance, jadi membaliknya membalik SELURUH riwayat.
    const { count } = await supabase
      .from("journal_lines").select("id", { count: "exact", head: true }).eq("account_id", id);

    const pesan = validasiUbahAkun(draft, lama!, (count ?? 0) > 0);
    if (pesan) gagal(pesan);

    // Nama akun rekening kas/bank ikut dirawat di cash_accounts — kalau hanya salah
    // satu yang diubah, nama di Buku Besar dan di daftar rekening jadi berbeda.
    const { data: rek } = await supabase
      .from("cash_accounts").select("id").eq("coa_code", lama!.code).maybeSingle();

    const { error } = await supabase
      .from("coa_accounts")
      .update({ name: draft.name, type: draft.type, normal_balance: draft.normal_balance })
      .eq("id", id);
    if (error) gagal(pesanSimpanGagal(error.message));
    if (rek) await supabase.from("cash_accounts").update({ nama: draft.name }).eq("id", rek.id);
  } else {
    const pesan = validasiAkunBaru(draft);
    if (pesan) gagal(pesan);

    const { error } = await supabase.from("coa_accounts").insert({
      code: draft.code, name: draft.name, type: draft.type,
      normal_balance: draft.normal_balance, is_active: true,
    });
    if (error) gagal(pesanSimpanGagal(error.message));
  }

  revalidatePath(BACK);
  redirect(`${BACK}?success=1`);
}

// Akun TIDAK PERNAH dihapus — jurnal lama menunjuk ke sini, dan menghapusnya ikut
// menghapus anggaran yang memakainya (budgets.coa_code on delete cascade).
// Yang tersedia hanya menonaktifkan, dan itu pun ditolak untuk akun yang dipakai.
export async function toggleAkun(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "bagan akun");
  const id = String(formData.get("id") ?? "").trim();
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) gagal("Akun tidak valid.");

  const { data: akun } = await supabase
    .from("coa_accounts").select("code, name").eq("id", id).maybeSingle();
  if (!akun) gagal("Akun tidak ditemukan.");

  // Menyalakan kembali selalu boleh; yang berbahaya cuma mematikan.
  if (aktif) {
    const pemakai = await pemakaiAkun(supabase, akun!.code);
    const alasan = alasanTakBolehNonaktif(akun!.code, pemakai);
    if (alasan) gagal(alasan);
  }

  const { error } = await supabase.from("coa_accounts").update({ is_active: !aktif }).eq("id", id);
  if (error) gagal(pesanSimpanGagal(error.message));

  revalidatePath(BACK);
  redirect(`${BACK}?success=1`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pemakaiAkun(supabase: any, code: string): Promise<PemakaiAkun> {
  const [{ count: jurnal }, { data: rek }, { data: kat }, { data: rj }] = await Promise.all([
    supabase.from("journal_lines").select("id, coa_accounts!inner(code)", { count: "exact", head: true })
      .eq("coa_accounts.code", code),
    supabase.from("cash_accounts").select("id").eq("coa_code", code).maybeSingle(),
    supabase.from("asset_categories").select("id")
      .or(`akun_beban.eq.${code},akun_akumulasi.eq.${code}`).maybeSingle(),
    // recurring_journals.lines = jsonb [{code,...}] tanpa FK — dicek manual.
    supabase.from("recurring_journals").select("lines").eq("is_active", true),
  ]);

  const dipakaiBerulang = ((rj ?? []) as { lines: { code?: string }[] | null }[])
    .some((r) => (r.lines ?? []).some((l) => l?.code === code));

  return {
    jurnal: jurnal ?? 0,
    rekeningKas: !!rek,
    kategoriAset: !!kat,
    jurnalBerulang: dipakaiBerulang,
  };
}
