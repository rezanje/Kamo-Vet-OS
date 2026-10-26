"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";

const BASE = "/penjualan/komisi";
const gagal = (msg: string): never => redirect(`${BASE}?error=${encodeURIComponent(msg)}`);

// Dropdown cakupan mengirim "" untuk "semua" — disimpan sebagai null.
const opsional = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

const groupCode = (value: FormDataEntryValue | null): string | null => {
  const code = String(value ?? "").trim().toLowerCase();
  if (code && !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(code)) gagal("Kode kelompok hanya boleh huruf kecil, angka, _ atau - (maks. 40)");
  return code || null;
};

export async function simpanKelompokKomisi(formData: FormData) {
  const supabase = await assertMasterAdmin(BASE, "kelompok komisi karyawan");
  const employeeId = String(formData.get("employee_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(employeeId)) gagal("Karyawan tidak valid");
  const code = groupCode(formData.get("commission_group"));
  const { data, error } = await supabase.from("employees")
    .update({ commission_group: code }).eq("id", employeeId).select("id").maybeSingle();
  if (error || !data) gagal("Kelompok karyawan gagal disimpan");
  redirect(`${BASE}?success=1`);
}

export async function simpanAturanKomisi(formData: FormData) {
  const supabase = await assertMasterAdmin(BASE, "aturan komisi");

  const id = String(formData.get("id") ?? "").trim();
  const nama = String(formData.get("nama") ?? "").trim();
  const tipe = String(formData.get("tipe") ?? "").trim();
  const basis = String(formData.get("basis") ?? "omzet").trim();
  const sumber = String(formData.get("sumber") ?? "semua").trim();
  const persen = Number(formData.get("persen")) || 0;
  const nominal = Number(formData.get("nominal")) || 0;
  const minOmzet = Number(formData.get("min_omzet")) || 0;
  const employeeId = opsional(formData.get("employee_id"));
  const commissionGroup = groupCode(formData.get("commission_group"));
  const overrideGroupRuleId = opsional(formData.get("override_group_rule_id"));

  if (!nama) gagal("Nama aturan wajib diisi");
  if (tipe !== "persen" && tipe !== "nominal") gagal("Jenis aturan tidak dikenal");
  if (basis !== "omzet" && basis !== "laba") gagal("Basis komisi tidak dikenal");
  if (!["semua", "kasir", "klinik", "reseller"].includes(sumber)) gagal("Sumber transaksi tidak dikenal");
  if (tipe === "persen" && (persen <= 0 || persen > 100)) gagal("Persen komisi harus di antara 0 dan 100");
  if (tipe === "nominal" && nominal <= 0) gagal("Nominal per unit harus lebih dari 0");
  if (minOmzet < 0) gagal("Ambang tidak boleh negatif");
  if (commissionGroup && employeeId) gagal("Pilih kelompok atau karyawan khusus, bukan keduanya");
  if (overrideGroupRuleId) {
    if (!employeeId || commissionGroup || overrideGroupRuleId === id) gagal("Pengecualian harus khusus satu karyawan dan merujuk aturan kelompok lain");
    const { data: base, error: baseError } = await supabase.from("commission_rules")
      .select("id, commission_group").eq("id", overrideGroupRuleId).maybeSingle();
    if (baseError || !base?.commission_group) gagal("Aturan kelompok yang diganti tidak tersedia");
  }

  const dari = opsional(formData.get("berlaku_dari"));
  const sampai = opsional(formData.get("berlaku_sampai"));
  if (dari && sampai && sampai < dari) gagal("Masa berlaku selesai lebih awal dari mulainya");

  const row = {
    nama, tipe, basis, sumber,
    persen: tipe === "persen" ? persen : 0,
    nominal: tipe === "nominal" ? nominal : 0,
    employee_id: employeeId,
    commission_group: commissionGroup,
    override_group_rule_id: overrideGroupRuleId,
    branch_id: opsional(formData.get("branch_id")),
    category_id: opsional(formData.get("category_id")),
    item_id: opsional(formData.get("item_id")),
    min_omzet: minOmzet,
    berlaku_dari: dari,
    berlaku_sampai: sampai,
  };

  const { error } = id
    ? await supabase.from("commission_rules").update(row).eq("id", id)
    : await supabase.from("commission_rules").insert(row);
  if (error) gagal(error.message);

  redirect(`${BASE}?success=1`);
}

export async function toggleAturanKomisi(formData: FormData) {
  const supabase = await assertMasterAdmin(BASE, "aturan komisi");
  const id = String(formData.get("id") ?? "").trim();
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) gagal("Aturan tidak valid");

  const { error } = await supabase.from("commission_rules").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BASE}?error=${encodeURIComponent(error.message)}` : `${BASE}?success=1`);
}

export async function hapusAturanKomisi(formData: FormData) {
  const supabase = await assertMasterAdmin(BASE, "aturan komisi");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) gagal("Aturan tidak valid");

  const { error } = await supabase.from("commission_rules").delete().eq("id", id);
  redirect(error ? `${BASE}?error=${encodeURIComponent(error.message)}` : `${BASE}?success=1`);
}
