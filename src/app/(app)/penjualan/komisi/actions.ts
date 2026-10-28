"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin, assertRole } from "@/lib/master-guard";

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
  // Pay configuration: only OWNER may move people between groups (DB-enforced too).
  const supabase = await assertRole(BASE, "kelompok komisi karyawan", ["OWNER"]);
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
  // Personal, group and exception rules are pay configuration: OWNER only (DB-enforced too).
  if (employeeId || commissionGroup || overrideGroupRuleId) await assertRole(BASE, "aturan komisi khusus karyawan/kelompok", ["OWNER"]);

  if (!nama) gagal("Nama aturan wajib diisi");
  if (tipe !== "persen" && tipe !== "nominal") gagal("Jenis aturan tidak dikenal");
  if (basis !== "omzet" && basis !== "laba") gagal("Basis komisi tidak dikenal");
  if (!["semua", "kasir", "klinik", "reseller", "visit_ranap"].includes(sumber)) gagal("Sumber transaksi tidak dikenal");
  // H06: tarif visit ranap = rupiah per visit dokter yang dikerjakan; tidak ada barang/kategori.
  if (sumber === "visit_ranap" && (tipe !== "nominal" || opsional(formData.get("item_id")) || opsional(formData.get("category_id"))))
    gagal("Insentif visit ranap memakai nominal per visit, tanpa barang atau kategori");
  if (tipe === "persen" && (persen <= 0 || persen > 100)) gagal("Persen komisi harus di antara 0 dan 100");
  if (tipe === "nominal" && nominal <= 0) gagal("Nominal per unit harus lebih dari 0");
  if (minOmzet < 0) gagal("Ambang tidak boleh negatif");
  if (commissionGroup && employeeId) gagal("Pilih kelompok atau karyawan khusus, bukan keduanya");
  if (overrideGroupRuleId) {
    if (!employeeId || commissionGroup || overrideGroupRuleId === id) gagal("Pengecualian harus khusus satu karyawan dan merujuk aturan kelompok lain");
    const [{ data: base, error: baseError }, { data: employee, error: employeeError }] = await Promise.all([
      supabase.from("commission_rules").select("id, commission_group, is_active").eq("id", overrideGroupRuleId).maybeSingle(),
      supabase.from("employees").select("id, commission_group").eq("id", employeeId).maybeSingle(),
    ]);
    const baseGroup = base?.commission_group ?? "";
    if (baseError || !baseGroup || !base?.is_active) gagal("Aturan kelompok yang diganti tidak aktif atau tidak tersedia");
    if (employeeError || !employee || employee.commission_group !== baseGroup) gagal("Kelompok karyawan harus cocok dengan aturan yang diganti");
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

  const { data, error } = await supabase.from("commission_rules").update({ is_active: !aktif }).eq("id", id).select("id");
  if (!error && !(data ?? []).length) gagal("Aturan khusus karyawan/kelompok hanya bisa diubah OWNER");
  redirect(error ? `${BASE}?error=${encodeURIComponent(error.message)}` : `${BASE}?success=1`);
}

export async function hapusAturanKomisi(formData: FormData) {
  const supabase = await assertMasterAdmin(BASE, "aturan komisi");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) gagal("Aturan tidak valid");

  const { data, error } = await supabase.from("commission_rules").delete().eq("id", id).select("id");
  if (!error && !(data ?? []).length) gagal("Aturan khusus karyawan/kelompok hanya bisa dihapus OWNER");
  redirect(error ? `${BASE}?error=${encodeURIComponent(error.message)}` : `${BASE}?success=1`);
}

/** Append-only: a later row at the same scope/date supersedes the previous choice. */
export async function simpanKebijakanKomisiJasa(formData: FormData) {
  // Pay configuration: OWNER only (DB-enforced by RLS too).
  const supabase = await assertRole(BASE, "kebijakan komisi jasa", ["OWNER"]);
  const mode = String(formData.get("mode") ?? "");
  const effectiveFrom = String(formData.get("effective_from") ?? "");
  const branchId = opsional(formData.get("branch_id"));
  if (!["pending", "personal_rules", "both_full", "split"].includes(mode)) gagal("Cara menghitung dua pelaksana wajib dipilih");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || Number.isNaN(Date.parse(`${effectiveFrom}T00:00:00Z`))
    || new Date(`${effectiveFrom}T00:00:00Z`).toISOString().slice(0,10)!==effectiveFrom) gagal("Tanggal berlaku tidak valid");
  if (branchId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branchId)) gagal("Cabang tidak valid");
  const doctorRaw = opsional(formData.get("doctor_share_pct"));
  const staffRaw = opsional(formData.get("staff_share_pct"));
  let doctorShare: number|null = null, staffShare: number|null = null;
  if (mode === "split") {
    if (doctorRaw===null || staffRaw===null) gagal("Persentase dokter dan non-dokter wajib diisi");
    doctorShare=Number(doctorRaw);staffShare=Number(staffRaw);
    if (!Number.isFinite(doctorShare) || !Number.isFinite(staffShare)
      || doctorShare<0 || doctorShare>100 || staffShare<0 || staffShare>100
      || Math.round((doctorShare+staffShare)*100)!==10000
      || Math.round(doctorShare*100)!==doctorShare*100 || Math.round(staffShare*100)!==staffShare*100)
      gagal("Persentase harus 0–100, maksimal dua desimal, dan berjumlah 100");
  } else if (doctorRaw!==null || staffRaw!==null) gagal("Persentase hanya untuk mode pembagian");
  const { error } = await supabase.from("service_commission_policies").insert({
    branch_id:branchId,effective_from:effectiveFrom,mode,
    doctor_share_pct:doctorShare,staff_share_pct:staffShare,
  });
  // Before the S04 migration is applied there is nowhere to save a choice; say so instead of a raw database error.
  if (error) gagal(error.code === "PGRST205" || error.code === "42P01"
    ? "Penyimpanan kebijakan komisi jasa belum terpasang di database. Hubungi pengelola rilis."
    : error.message);
  redirect(`${BASE}?success=1`);
}
