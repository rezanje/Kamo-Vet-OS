"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { METODE_BAYAR } from "@/lib/kas-akun";

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

  await supabase.from("payment_account_map").delete().eq("metode", metode).eq("branch_id", branchId);
  const { error } = await supabase
    .from("payment_account_map").insert({ metode, branch_id: branchId, cash_account_id: accountId });
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
