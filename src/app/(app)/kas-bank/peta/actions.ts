"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { METODE_BAYAR } from "@/lib/kas-akun";
import { isBranchCashAccount } from "@/lib/branch-cash-config";

const BACK = "/kas-bank/peta";
const BOLEH = ["OWNER", "ADMIN", "FINANCE"];

const gagal = (msg: string): never => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

// Aturan pusat: satu form untuk semua metode sekaligus. Baris kosong = ikut bawaan
// (Tunai→Kas, selain itu→Bank), jadi mengosongkan pilihan berarti menghapus aturannya.
export async function simpanPetaPusat(formData: FormData) {
  const supabase = await assertRole(BACK, "peta rekening", BOLEH);

  for (const metode of METODE_BAYAR) {
    const accountId = String(formData.get(`rek_${metode}`) ?? "").trim();
    // Index uniknya PARSIAL (branch_id is null), sehingga upsert ON CONFLICT tidak bisa
    // dipakai — hapus dulu, baru insert.
    await supabase.from("payment_account_map").delete().eq("metode", metode).is("branch_id", null);
    if (accountId) {
      const { error } = await supabase
        .from("payment_account_map").insert({ metode, branch_id: null, cash_account_id: accountId });
      if (error) gagal(`Gagal menyimpan aturan ${metode}: ${error.message}`);
    }
  }

  redirect(`${BACK}?success=pusat`);
}

export async function simpanPetaCabang(formData: FormData) {
  const supabase = await assertRole(BACK, "peta rekening", BOLEH);

  const branchId = String(formData.get("branch_id") ?? "").trim();
  const metode = String(formData.get("metode") ?? "").trim();
  const accountId = String(formData.get("cash_account_id") ?? "").trim();

  if (!branchId) gagal("Pilih cabang");
  if (!METODE_BAYAR.includes(metode as (typeof METODE_BAYAR)[number])) gagal("Metode bayar tidak dikenal");
  if (!accountId) gagal("Pilih rekening");

  if (metode === "Tunai") {
    const [{ data: account, error: accountError }, { data: branch, error: branchError }] = await Promise.all([
      supabase.from("cash_accounts").select("coa_code, branch_id, jenis, is_active").eq("id", accountId).maybeSingle(),
      supabase.from("branches").select("code").eq("id", branchId).eq("is_active", true).maybeSingle(),
    ]);
    if (accountError || branchError || !branch || !isBranchCashAccount(account, branchId, branch.code)) {
      gagal("Rekening Tunai harus kas aktif yang tepat untuk cabang terpilih");
    }
  }

  // Keep the old mapping until the replacement passes the database guard.
  // The partial unique index cannot be used as a normal upsert conflict target.
  const { data: existing, error: readError } = await supabase.from("payment_account_map")
    .select("id").eq("metode", metode).eq("branch_id", branchId).maybeSingle();
  if (readError) gagal(readError.message);
  const { error } = existing
    ? await supabase.from("payment_account_map").update({ cash_account_id: accountId }).eq("id", existing.id)
    : await supabase.from("payment_account_map").insert({ metode, branch_id: branchId, cash_account_id: accountId });
  if (error) gagal(error.message);

  redirect(`${BACK}?success=cabang`);
}

export async function hapusPeta(formData: FormData) {
  const supabase = await assertRole(BACK, "peta rekening", BOLEH);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) gagal("Aturan tidak valid");
  await supabase.from("payment_account_map").delete().eq("id", id);
  redirect(`${BACK}?success=hapus`);
}
