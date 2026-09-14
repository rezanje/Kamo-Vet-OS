"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/master-guard";
import { geserHari } from "@/lib/tanggal";

const BACK = "/klinik/maintenance";

export async function simpanAlatMedis(formData: FormData) {
  const supabase = await assertRole(BACK, "alat medis", ["OWNER", "ADMIN"]);
  const name = String(formData.get("name") ?? "").trim();
  const branchId = String(formData.get("branch_id") ?? "").trim();
  if (!name || !branchId) redirect(`${BACK}?error=${encodeURIComponent("Nama alat dan cabang wajib diisi")}`);
  const interval = Math.max(1, Number(formData.get("maintenance_interval_days")) || 180);
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("medical_equipment").insert({
    name, branch_id: branchId,
    category: String(formData.get("category") ?? "").trim() || null,
    serial_number: String(formData.get("serial_number") ?? "").trim() || null,
    location: String(formData.get("location") ?? "").trim() || null,
    purchase_date: String(formData.get("purchase_date") ?? "").trim() || null,
    warranty_until: String(formData.get("warranty_until") ?? "").trim() || null,
    maintenance_interval_days: interval,
    next_maintenance_date: String(formData.get("next_maintenance_date") ?? "").trim() || null,
    status: String(formData.get("status") ?? "Aktif"),
    notes: String(formData.get("notes") ?? "").trim() || null,
    created_by: user?.id ?? null,
  });
  if (error) redirect(`${BACK}?error=${encodeURIComponent("Alat medis belum tersimpan")}`);
  revalidatePath(BACK);
  redirect(`${BACK}?success=equipment`);
}

export async function simpanMaintenance(formData: FormData) {
  const supabase = await assertRole(BACK, "riwayat maintenance", ["OWNER", "ADMIN"]);
  const equipmentId = String(formData.get("equipment_id") ?? "").trim();
  const date = String(formData.get("maintenance_date") ?? "").trim();
  const type = String(formData.get("maintenance_type") ?? "").trim();
  if (!equipmentId || !date || !type) redirect(`${BACK}?error=${encodeURIComponent("Alat, tanggal, dan jenis maintenance wajib diisi")}`);
  const { data: { user } } = await supabase.auth.getUser();
  const nextDue = String(formData.get("next_due_date") ?? "").trim() || null;
  const { error } = await supabase.from("medical_equipment_maintenance").insert({
    equipment_id: equipmentId, maintenance_date: date, maintenance_type: type,
    technician: String(formData.get("technician") ?? "").trim() || null,
    vendor: String(formData.get("vendor") ?? "").trim() || null,
    cost: Math.max(0, Number(formData.get("cost")) || 0),
    result: String(formData.get("result") ?? "").trim() || null,
    next_due_date: nextDue, created_by: user?.id ?? null,
  });
  if (error) redirect(`${BACK}?error=${encodeURIComponent("Riwayat maintenance belum tersimpan")}`);
  const { data: equipment } = await supabase.from("medical_equipment").select("id, maintenance_interval_days").eq("id", equipmentId).maybeSingle();
  const calculatedNextDue = nextDue || (equipment ? geserHari(date, Number(equipment.maintenance_interval_days) || 180) : null);
  if (equipment) await supabase.from("medical_equipment").update({ next_maintenance_date: calculatedNextDue, status: "Aktif" }).eq("id", equipmentId);
  revalidatePath(BACK);
  redirect(`${BACK}?success=maintenance`);
}
