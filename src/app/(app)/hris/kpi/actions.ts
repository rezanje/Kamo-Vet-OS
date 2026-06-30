"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function simpanKpi(formData: FormData) {
  const supabase = await createClient();

  const employeeId = String(formData.get("employee_id") ?? "").trim();
  const periode = String(formData.get("periode") ?? "").trim();
  const metrik = String(formData.get("metrik") ?? "").trim();
  const target = formData.get("target") !== "" ? Number(formData.get("target")) : null;
  const realisasi = formData.get("realisasi") !== "" ? Number(formData.get("realisasi")) : null;
  const skor = Number(formData.get("skor") ?? 0);
  const catatan = String(formData.get("catatan") ?? "").trim() || null;

  // ponytail: validasi karyawan + metrik wajib sebelum insert.
  if (!employeeId) {
    redirect(`/hris/kpi?error=${encodeURIComponent("Karyawan wajib dipilih")}`);
  }
  if (!metrik) {
    redirect(`/hris/kpi?error=${encodeURIComponent("Metrik KPI wajib diisi")}`);
  }
  if (!periode) {
    redirect(`/hris/kpi?error=${encodeURIComponent("Periode wajib diisi")}`);
  }

  const { error } = await supabase.from("kpi_records").insert({
    employee_id: employeeId,
    periode,
    metrik,
    target,
    realisasi,
    skor,
    catatan,
  });

  if (error) {
    redirect(`/hris/kpi?error=${encodeURIComponent("Gagal menyimpan data KPI: " + error.message)}`);
  }

  redirect(`/hris/kpi?success=1&periode=${encodeURIComponent(periode)}`);
}
