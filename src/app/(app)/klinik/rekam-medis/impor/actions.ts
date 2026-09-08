"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  bacaWorkbooksRekamMedis,
  bolehKonfirmasiImporRekamMedis,
  pilahRiwayatTersimpan,
  type RekamMedisImporHeld,
  type RekamMedisImporRow,
} from "@/lib/impor-rekam-medis";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_BATCH_BYTES = 30 * 1024 * 1024;

type ImportRpcClient = {
  rpc: (name: "import_legacy_medical_record", args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
};

export type RekamMedisImportState = {
  ok: boolean;
  phase: "preview" | "done";
  message: string;
  rows: RekamMedisImporRow[];
  held: RekamMedisImporHeld[];
  ignored_sheets: number;
};

const empty = (message: string): RekamMedisImportState => ({
  ok: false, phase: "preview", message, rows: [], held: [], ignored_sheets: 0,
});

async function assertBolehImpor() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Silakan masuk ulang.");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER" && profile?.role !== "ADMIN") {
    throw new Error("Hanya OWNER/ADMIN yang boleh mengimpor rekam medis.");
  }
  return supabase;
}

function files(formData: FormData): Array<{ file: File; sourcePath: string }> {
  const uploads = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  if (!uploads.length) throw new Error("Pilih minimal satu file .xlsx.");
  if (uploads.some((file) => !file.name.toLowerCase().endsWith(".xlsx"))) throw new Error("Semua file harus berformat .xlsx.");
  if (uploads.some((file) => file.size > MAX_FILE_BYTES)) throw new Error("Satu file maksimal 5 MB.");
  if (uploads.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES) throw new Error("Total file maksimal 30 MB per impor.");
  const sourcePaths = formData.getAll("paths");
  return uploads.map((file, index) => {
    const candidate = typeof sourcePaths[index] === "string" ? sourcePaths[index].replace(/\\/g, "/") : file.name;
    const parts = candidate.split("/").filter(Boolean);
    const safePath = candidate.length <= 500 && !parts.includes("..") && parts.at(-1) === file.name
      ? parts.join("/")
      : file.name;
    return { file, sourcePath: safePath };
  });
}

async function baca(formData: FormData) {
  const uploads = files(formData);
  return bacaWorkbooksRekamMedis(await Promise.all(uploads.map(async ({ file, sourcePath }) => ({
    fileName: file.name,
    sourcePath,
    bytes: new Uint8Array(await file.arrayBuffer()),
  }))));
}

export async function previewImporRekamMedis(formData: FormData): Promise<RekamMedisImportState> {
  try {
    await assertBolehImpor();
    const result = await baca(formData);
    return {
      ok: result.rows.length > 0,
      phase: "preview",
      message: result.rows.length
        ? `${result.rows.length} riwayat siap dicek. ${result.held.length} riwayat ditahan.`
        : "Tidak ada riwayat yang aman untuk diimpor.",
      ...result,
    };
  } catch (error) {
    return empty(error instanceof Error ? error.message : "File gagal dibaca.");
  }
}

export async function konfirmasiImporRekamMedis(formData: FormData): Promise<RekamMedisImportState> {
  try {
    const supabase = await assertBolehImpor();
    if (String(formData.get("approved") ?? "") !== "true") throw new Error("Centang persetujuan impor setelah meninjau hasil cek.");
    const result = await baca(formData);
    if (!bolehKonfirmasiImporRekamMedis(result.rows.length, true)) throw new Error("Tidak ada riwayat yang aman untuk diimpor.");

    const { data: existing, error: existingError } = await supabase
      .from("visits").select("legacy_source_key")
      .in("legacy_source_key", result.rows.map((row) => row.source_key));
    if (existingError) throw new Error(existingError.message);
    const { baru, sudah_ada } = pilahRiwayatTersimpan(
      result.rows,
      (existing ?? []).flatMap((row) => row.legacy_source_key ? [row.legacy_source_key] : []),
    );

    const importClient = supabase as unknown as ImportRpcClient;
    for (const row of baru) {
      const { error } = await importClient.rpc("import_legacy_medical_record", {
        p_source_key: row.source_key,
        p_record_no: row.record_no,
        p_record_date: `${row.record_date}T00:00:00+07:00`,
        p_owner_name: row.owner_name,
        p_phone: row.phone,
        p_address: row.address,
        p_patient_name: row.patient_name,
        p_species: row.species,
        p_breed: row.breed,
        p_gender: row.gender,
        p_dob: row.dob,
        p_doctor: row.doctor,
        p_note: row.note,
        p_anamnesis: row.anamnesis,
        p_clinical_findings: row.clinical_findings,
        p_diagnosis: row.diagnosis,
        p_therapy: row.therapy,
      });
      if (error) throw new Error(error.message);
    }
    revalidatePath("/klinik/antrian");
    revalidatePath("/crm/pelanggan");
    const existingMessage = sudah_ada ? ` ${sudah_ada} riwayat sudah ada dan tidak digandakan.` : "";
    return { ok: true, phase: "done", message: `${baru.length} riwayat baru berhasil disimpan.${existingMessage}`, ...result };
  } catch (error) {
    return empty(error instanceof Error ? error.message : "Impor gagal.");
  }
}
