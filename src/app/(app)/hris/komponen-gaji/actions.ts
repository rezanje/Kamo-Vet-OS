"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertPayrollOwner } from "@/lib/master-guard";

const BACK = "/hris/komponen-gaji";
const gagal = (msg: string): never => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

export async function simpanKomponen(formData: FormData) {
  const supabase = await assertPayrollOwner(BACK);

  const id = String(formData.get("id") ?? "").trim();
  const nama = String(formData.get("nama") ?? "").trim();
  const tipe = String(formData.get("tipe") ?? "").trim();
  const nominalRaw = String(formData.get("nominal") ?? "").trim();
  const nominal = nominalRaw === "" ? 0 : Number(nominalRaw);
  const calculationBasis = String(formData.get("calculation_basis") ?? "fixed");
  const salesSource = String(formData.get("sales_source") ?? "semua");
  const salesScope = String(formData.get("sales_scope") ?? "employee");
  const rateRaw = String(formData.get("rate_percent") ?? "").trim();
  const ratePercent = rateRaw === "" ? 0 : Number(rateRaw);
  const employeeContext = String(formData.get("emp") ?? "").trim();
  const emp = /^[0-9a-f-]{36}$/i.test(employeeContext) ? employeeContext : "";
  const gagalSimpan = (message: string): never => {
    const query = new URLSearchParams({ error: message, ...(id ? { edit: id } : {}), ...(emp ? { emp } : {}) });
    redirect(`${BACK}?${query}`);
  };

  if (!nama) gagalSimpan("Nama komponen wajib diisi");
  if (tipe !== "tunjangan" && tipe !== "potongan") gagalSimpan("Jenis komponen tidak dikenal");
  if (!Number.isFinite(nominal) || nominal < 0) gagalSimpan("Nominal tidak valid");
  if (!["fixed", "net_turnover"].includes(calculationBasis)) gagalSimpan("Dasar komponen tidak dikenal");
  if (!["semua", "kasir", "klinik", "reseller"].includes(salesSource)) gagalSimpan("Sumber omzet tidak dikenal");
  if (!["employee", "own_branch", "all_branches"].includes(salesScope)) gagalSimpan("Cakupan omzet tidak dikenal");
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100 || (calculationBasis === "net_turnover" && ratePercent === 0)) gagalSimpan("Persentase omzet harus lebih dari 0 sampai 100");

  const row = { nama, tipe, nominal: calculationBasis === "fixed" ? nominal : 0,
    calculation_basis: calculationBasis, sales_source: salesSource, sales_scope: salesScope,
    rate_percent: calculationBasis === "net_turnover" ? ratePercent : 0 };
  const { error } = id
    ? await supabase.from("salary_components").update(row).eq("id", id)
    : await supabase.from("salary_components").insert(row);
  if (error) gagalSimpan(error.message);

  revalidatePath(BACK);
  if (emp) revalidatePath(`/hris/karyawan/${emp}`);
  const query = new URLSearchParams({ success: "1", ...(emp ? { emp } : {}) });
  redirect(`${BACK}?${query}`);
}

export async function toggleKomponen(formData: FormData) {
  const supabase = await assertPayrollOwner(BACK);
  const id = String(formData.get("id") ?? "").trim();
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) gagal("Komponen tidak valid");

  const { error } = await supabase.from("salary_components").update({ is_active: !aktif }).eq("id", id);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=1`);
}

// Pasang komponen ke karyawan. Nominal kosong = ikut nominal bawaan komponen,
// supaya naik-turun tunjangan cukup diubah sekali di master.
export async function pasangKomponen(formData: FormData) {
  const supabase = await assertPayrollOwner(BACK);

  const employeeId = String(formData.get("employee_id") ?? "").trim();
  const componentId = String(formData.get("component_id") ?? "").trim();
  const back = formData.get("return_to") === "profil" && /^[0-9a-f-]{36}$/i.test(employeeId) ? `/hris/karyawan/${employeeId}` : BACK;
  const gagalPasang = (msg: string): never => redirect(`${back}?error=${encodeURIComponent(msg)}`);
  const nominalRaw = String(formData.get("nominal") ?? "").trim();
  const nominal = nominalRaw === "" ? null : Number(nominalRaw);
  const rateRaw = String(formData.get("rate_percent_override") ?? "").trim();
  const ratePercentOverride = rateRaw === "" ? null : Number(rateRaw);
  const overrideReason = String(formData.get("override_reason") ?? "").trim().slice(0, 300) || null;

  if (!employeeId) gagalPasang("Pilih karyawan");
  if (!componentId) gagalPasang("Pilih komponen");
  if (nominal !== null && (!Number.isFinite(nominal) || nominal < 0)) gagalPasang("Nominal tidak valid");
  if (ratePercentOverride !== null && (!Number.isFinite(ratePercentOverride) || ratePercentOverride <= 0 || ratePercentOverride > 100)) gagalPasang("Persentase khusus harus lebih dari 0 sampai 100");

  const { data: component, error: componentError } = await supabase.from("salary_components")
    .select("calculation_basis, is_active").eq("id", componentId).maybeSingle();
  if (componentError) gagalPasang("Komponen belum dapat diverifikasi");
  if (!component) throw new Error("Komponen belum dapat diverifikasi");
  if (!component.is_active) gagalPasang("Komponen tidak aktif");
  if (component.calculation_basis === "net_turnover" && nominal !== null) gagalPasang("Komponen omzet memakai persentase, bukan nominal");
  if (component.calculation_basis === "fixed" && ratePercentOverride !== null) gagalPasang("Komponen tetap memakai nominal, bukan persentase");

  // H02: replacing a value that comes from the employee's template is an explicit,
  // recorded exception — it needs a reason.
  const { data: link, error: linkError } = await supabase.from("employee_payslip_templates")
    .select("template_id").eq("employee_id", employeeId).maybeSingle();
  if (linkError) gagalPasang("Template slip karyawan belum dapat diverifikasi");
  if (link?.template_id) {
    const { data: inTemplate, error: templateError } = await supabase.from("payslip_template_components")
      .select("id").eq("template_id", link.template_id).eq("component_id", componentId).maybeSingle();
    if (templateError) gagalPasang("Template slip karyawan belum dapat diverifikasi");
    if (inTemplate && !overrideReason) gagalPasang("Komponen ini ada di template karyawan. Isi alasan pengecualian.");
  }

  // Index uniknya (employee_id, component_id) penuh — upsert aman di sini.
  const { error } = await supabase
    .from("employee_salary_components")
    .upsert({ employee_id: employeeId, component_id: componentId, nominal, rate_percent_override: ratePercentOverride, override_reason: overrideReason }, { onConflict: "employee_id,component_id" });
  if (error) gagalPasang(error.message);

  revalidatePath(back);
  revalidatePath(BACK);
  revalidatePath("/hris/penggajian");
  redirect(`${back}?success=${back === BACK ? "1" : "benefit"}&emp=${employeeId}`);
}

export async function lepasKomponen(formData: FormData) {
  const supabase = await assertPayrollOwner(BACK);
  const id = String(formData.get("id") ?? "").trim();
  const emp = String(formData.get("employee_id") ?? "").trim();
  const back = formData.get("return_to") === "profil" && /^[0-9a-f-]{36}$/i.test(emp) ? `/hris/karyawan/${emp}` : BACK;
  if (!id || !emp) redirect(`${back}?error=Data%20tidak%20valid`);
  const { error } = await supabase.from("employee_salary_components").delete().eq("id", id).eq("employee_id", emp);
  if (error) redirect(`${back}?error=${encodeURIComponent("Komponen gagal dilepas")}`);
  revalidatePath(back);
  revalidatePath(BACK);
  revalidatePath("/hris/penggajian");
  redirect(`${back}?success=${back === BACK ? "1" : "benefit"}&emp=${emp}`);
}

// ── H02: template slip gaji per kelompok ─────────────────────────────────────
const KODE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const angkaOpsional = (value: FormDataEntryValue | null): number | null => {
  const raw = String(value ?? "").trim();
  return raw === "" ? null : Number(raw);
};

export async function simpanTemplateSlip(formData: FormData) {
  const supabase = await assertPayrollOwner(BACK);
  const kode = String(formData.get("template_kode") ?? "").trim().toLowerCase();
  const nama = String(formData.get("template_nama") ?? "").trim();
  if (!KODE.test(kode)) gagal("Kode template hanya huruf kecil, angka, _ atau - (maks. 40)");
  if (!nama) gagal("Nama template wajib diisi");
  const { error } = await supabase.from("payslip_templates").insert({ kode, nama });
  if (error) gagal(error.code === "23505" ? "Kode template sudah dipakai" : "Template gagal disimpan");
  revalidatePath(BACK);
  redirect(`${BACK}?success=1`);
}

export async function pasangKomponenTemplate(formData: FormData) {
  const supabase = await assertPayrollOwner(BACK);
  const templateId = String(formData.get("template_id") ?? "");
  const componentId = String(formData.get("component_id") ?? "");
  const nominal = angkaOpsional(formData.get("nominal"));
  const ratePercent = angkaOpsional(formData.get("rate_percent"));
  if (!UUID.test(templateId) || !UUID.test(componentId)) gagal("Pilih template dan komponen");
  if (nominal !== null && (!Number.isFinite(nominal) || nominal < 0)) gagal("Nominal template tidak valid");
  if (ratePercent !== null && (!Number.isFinite(ratePercent) || ratePercent <= 0 || ratePercent > 100)) gagal("Persentase template harus lebih dari 0 sampai 100");
  const { data: component, error: componentError } = await supabase.from("salary_components")
    .select("calculation_basis, is_active").eq("id", componentId).maybeSingle();
  if (componentError || !component) gagal("Komponen belum dapat diverifikasi");
  if (!component!.is_active) gagal("Komponen tidak aktif");
  if (component!.calculation_basis === "net_turnover" && nominal !== null) gagal("Komponen omzet memakai persentase, bukan nominal");
  if (component!.calculation_basis === "fixed" && ratePercent !== null) gagal("Komponen tetap memakai nominal, bukan persentase");
  const { error } = await supabase.from("payslip_template_components")
    .upsert({ template_id: templateId, component_id: componentId, nominal, rate_percent: ratePercent }, { onConflict: "template_id,component_id" });
  if (error) gagal("Komponen template gagal disimpan");
  revalidatePath(BACK);
  revalidatePath("/hris/penggajian");
  redirect(`${BACK}?success=1`);
}

export async function lepasKomponenTemplate(formData: FormData) {
  const supabase = await assertPayrollOwner(BACK);
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) gagal("Data tidak valid");
  const { error } = await supabase.from("payslip_template_components").delete().eq("id", id);
  if (error) gagal("Komponen template gagal dilepas");
  revalidatePath(BACK);
  revalidatePath("/hris/penggajian");
  redirect(`${BACK}?success=1`);
}

/** One template per employee; empty value removes the link. History is written by the database. */
export async function pasangTemplateKaryawan(formData: FormData) {
  const supabase = await assertPayrollOwner(BACK);
  const employeeId = String(formData.get("employee_id") ?? "");
  const templateId = String(formData.get("template_id") ?? "");
  if (!UUID.test(employeeId)) gagal("Karyawan tidak valid");
  const back = `/hris/karyawan/${employeeId}`;
  if (templateId && !UUID.test(templateId)) redirect(`${back}?error=${encodeURIComponent("Template tidak valid")}`);
  const { error } = templateId
    ? await supabase.from("employee_payslip_templates")
      .upsert({ employee_id: employeeId, template_id: templateId, updated_at: new Date().toISOString() }, { onConflict: "employee_id" })
    : await supabase.from("employee_payslip_templates").delete().eq("employee_id", employeeId);
  if (error) redirect(`${back}?error=${encodeURIComponent("Template slip gagal disimpan")}`);
  revalidatePath(back);
  revalidatePath("/hris/penggajian");
  redirect(`${back}?success=benefit`);
}
