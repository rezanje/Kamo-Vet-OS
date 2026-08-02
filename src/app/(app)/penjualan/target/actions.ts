"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";

const BASE = "/penjualan/target";
const kembali = (periode: string) => `${BASE}?periode=${periode}`;

const opsional = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

export async function simpanTarget(formData: FormData) {
  const periode = String(formData.get("periode") ?? "").trim();
  const gagal = (msg: string): never => redirect(`${kembali(periode)}&error=${encodeURIComponent(msg)}`);
  if (!/^\d{4}-\d{2}$/.test(periode)) redirect(`${BASE}?error=${encodeURIComponent("Periode tidak valid")}`);

  const supabase = await assertMasterAdmin(kembali(periode), "target penjualan");

  const basis = String(formData.get("basis") ?? "omzet").trim();
  const target = Number(formData.get("target")) || 0;
  if (basis !== "omzet" && basis !== "laba") gagal("Basis target tidak dikenal");
  if (target <= 0) gagal("Nilai target harus lebih dari 0");

  const { error } = await supabase.from("sales_targets").insert({
    periode,
    employee_id: opsional(formData.get("employee_id")),
    branch_id: opsional(formData.get("branch_id")),
    category_id: opsional(formData.get("category_id")),
    basis,
    target,
  });
  // Index unik menjaga satu kombinasi cakupan cuma punya satu target per periode.
  if (error) gagal(error.code === "23505" ? "Target untuk cakupan ini sudah ada di periode tersebut" : error.message);

  redirect(`${kembali(periode)}&success=1`);
}

export async function hapusTarget(formData: FormData) {
  const periode = String(formData.get("periode") ?? "").trim();
  const supabase = await assertMasterAdmin(kembali(periode), "target penjualan");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) redirect(`${kembali(periode)}&error=${encodeURIComponent("Target tidak valid")}`);

  const { error } = await supabase.from("sales_targets").delete().eq("id", id);
  redirect(error ? `${kembali(periode)}&error=${encodeURIComponent(error.message)}` : `${kembali(periode)}&success=1`);
}
