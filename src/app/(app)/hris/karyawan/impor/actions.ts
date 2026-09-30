"use server";

import { redirect } from "next/navigation";
import { assertMasterAdmin } from "@/lib/master-guard";
import { BATAS_FILE_KARYAWAN, bacaExcelKaryawan } from "@/lib/impor-karyawan-excel";

const BACK = "/hris/karyawan/impor";

export async function imporKaryawanExcel(formData: FormData) {
  const supabase = await assertMasterAdmin(BACK, "data karyawan");
  const gagal = (pesan: string): never => redirect(`${BACK}?error=${encodeURIComponent(pesan)}`);
  const fileValue = formData.get("file");
  if (!(fileValue instanceof File)) gagal("Pilih file Excel .xlsx yang berisi data karyawan.");
  const file = fileValue as File;
  if (!file.name.toLowerCase().endsWith(".xlsx") || file.size === 0) {
    gagal("Pilih file Excel .xlsx yang berisi data karyawan.");
  }
  if (file.size > BATAS_FILE_KARYAWAN) gagal("File melebihi 900 KB. Pisahkan menjadi beberapa file.");

  const branchId = String(formData.get("branch_id") ?? "").trim() || null;
  if (branchId) {
    const { data: branch, error } = await supabase.from("branches")
      .select("id").eq("id", branchId).eq("is_active", true).maybeSingle();
    if (error || !branch) gagal("Cabang tidak aktif atau tidak ditemukan.");
  }

  const hasil = await bacaExcelKaryawan(Buffer.from(await file.arrayBuffer()));
  if (hasil.errors.length) {
    const ringkas = hasil.errors.slice(0, 4).join("; ");
    gagal(`${hasil.errors.length} masalah ditemukan. Tidak ada data disimpan. ${ringkas}`);
  }
  if (hasil.rows.length === 0) gagal("File belum berisi data karyawan.");
  if (Buffer.byteLength(JSON.stringify(hasil.rows), "utf8") > 900_000) {
    gagal("Isi data terlalu besar. Pisahkan menjadi beberapa file.");
  }

  const { data, error } = await supabase.rpc("import_employee_excel", {
    p_rows: hasil.rows,
    p_branch_id: branchId,
  });
  if (error) {
    gagal(error.code === "PGRST202"
      ? "Fitur impor belum aktif di basis data. Hubungi admin sistem."
      : "Data karyawan belum tersimpan. Periksa file dan coba lagi.");
  }
  const ringkasan = data as { inserted?: number; skipped?: number } | null;
  const masuk = Number(ringkasan?.inserted ?? 0);
  const dilewati = Number(ringkasan?.skipped ?? 0);
  redirect(`${BACK}?success=${encodeURIComponent(`${masuk} karyawan masuk, ${dilewati} ID sudah ada dan dilewati. Data lama tidak diubah.`)}`);
}
