"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  bacaWorkbooksRekamMedis,
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

export type RekamMedisBatchResult = {
  ok: boolean;
  message: string;
  tersimpan: number;
  sudah_ada: number;
};

const empty = (message: string): RekamMedisImportState => ({
  ok: false,
  phase: "preview",
  message,
  rows: [],
  held: [],
  ignored_sheets: 0,
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
  if (uploads.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES) throw new Error("Total file maksimal 30 MB per cek.");
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
        : "Tidak ada riwayat yang aman untuk dicek.",
      ...result,
    };
  } catch (error) {
    return empty(error instanceof Error ? error.message : "File gagal dibaca.");
  }
}

function cleanText(value: unknown, max: number): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function validasiRows(input: unknown): RekamMedisImporRow[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error("Tidak ada riwayat yang siap disimpan.");
  if (input.length > 50) throw new Error("Terlalu banyak riwayat dalam satu kiriman.");
  return input.map((candidate) => {
    if (!candidate || typeof candidate !== "object") throw new Error("Format riwayat tidak valid.");
    const row = candidate as Partial<RekamMedisImporRow>;
    const recordDate = cleanText(row.record_date, 10);
    const normalized: RekamMedisImporRow = {
      source_key: cleanText(row.source_key, 500) ?? "",
      source_file: cleanText(row.source_file, 255) ?? "",
      source_sheet: cleanText(row.source_sheet, 255) ?? "",
      record_no: cleanText(row.record_no, 100),
      record_date: recordDate,
      patient_name: cleanText(row.patient_name, 160),
      owner_name: cleanText(row.owner_name, 160),
      phone: cleanText(row.phone, 40),
      address: cleanText(row.address, 1_000),
      species: cleanText(row.species, 100),
      breed: cleanText(row.breed, 100),
      gender: cleanText(row.gender, 50),
      dob: cleanText(row.dob, 10),
      doctor: cleanText(row.doctor, 160),
      note: cleanText(row.note, 5_000),
      anamnesis: cleanText(row.anamnesis, 10_000),
      clinical_findings: cleanText(row.clinical_findings, 10_000),
      diagnosis: cleanText(row.diagnosis, 10_000),
      therapy: cleanText(row.therapy, 10_000),
      warning: Array.isArray(row.warning) ? row.warning.map((warning) => String(warning).slice(0, 255)).slice(0, 20) : [],
    };
    if (!normalized.source_key || !normalized.source_file || !normalized.source_sheet || !normalized.patient_name || !normalized.owner_name || !normalized.phone) {
      throw new Error("Ada riwayat yang kehilangan identitas wajib. Cek ulang file.");
    }
    if (!recordDate || !/^\d{4}-\d{2}-\d{2}$/.test(recordDate)) throw new Error("Ada tanggal riwayat yang tidak valid.");
    return normalized;
  });
}

export async function simpanBatchImporRekamMedis(
  input: RekamMedisImporRow[],
  finalBatch = false,
): Promise<RekamMedisBatchResult> {
  try {
    const supabase = await assertBolehImpor();
    const rows = validasiRows(input);
    const { data: existing, error: existingError } = await supabase
      .from("visits").select("legacy_source_key")
      .in("legacy_source_key", rows.map((row) => row.source_key));
    if (existingError) throw new Error(existingError.message);
    const { baru, sudah_ada } = pilahRiwayatTersimpan(
      rows,
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
    if (finalBatch) {
      revalidatePath("/klinik/antrian");
      revalidatePath("/crm/pelanggan");
    }
    return {
      ok: true,
      message: `${baru.length} riwayat disimpan.`,
      tersimpan: baru.length,
      sudah_ada,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Impor gagal.",
      tersimpan: 0,
      sudah_ada: 0,
    };
  }
}
