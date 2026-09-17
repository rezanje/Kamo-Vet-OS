"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  bacaWorkbooksRekamMedis,
  bolehKonfirmasiImporRekamMedis,
  jalankanTerbatasImporRekamMedis,
  klarifikasiIdentitasRekamMedis,
  pilahRiwayatTersimpan,
  type RekamMedisIdentityClarification,
  type RekamMedisImporHeld,
  type RekamMedisImporRow,
} from "@/lib/impor-rekam-medis";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_BATCH_BYTES = 30 * 1024 * 1024;

type ImportRpcClient = {
  rpc: (name: "import_legacy_medical_record_resolved", args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
};

const BERSAMAAN_SIMPAN = 4;

export type RekamMedisImportState = {
  ok: boolean;
  phase: "preview" | "done";
  message: string;
  rows: RekamMedisImporRow[];
  held: RekamMedisImporHeld[];
  ignored_sheets: number;
  clarifications: RekamMedisIdentityClarification[];
};

export type RekamMedisBatchResult = {
  ok: boolean;
  message: string;
  tersimpan: number;
  sudah_ada: number;
  dilewati: number;
};

const empty = (message: string): RekamMedisImportState => ({
  ok: false, phase: "preview", message, rows: [], held: [], ignored_sheets: 0, clarifications: [],
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadAllImportIdentityRows(supabase: any, table: "customers" | "pets", columns: string) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data ?? []).length < 1_000) return rows;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadIdentityClarifications(supabase: any, rows: RekamMedisImporRow[]) {
  const [ownerRows, petRows] = await Promise.all([
    loadAllImportIdentityRows(supabase, "customers", "id,name,phone"),
    loadAllImportIdentityRows(supabase, "pets", "id,customer_id,name"),
  ]);
  return klarifikasiIdentitasRekamMedis(
    rows,
    ownerRows.map((owner) => ({ id: String(owner.id), name: String(owner.name ?? ""), phone: owner.phone ? String(owner.phone) : null })),
    petRows.map((pet) => ({ id: String(pet.id), customer_id: String(pet.customer_id), name: String(pet.name ?? "") })),
  );
}

export type RekamMedisIdentityDecision = { source_key: string; decision: "skip" | { customer_id: string; pet_id: string | null } };

function parseIdentityDecisions(value: unknown): RekamMedisIdentityDecision[] {
  if (!Array.isArray(value)) throw new Error("Keputusan klarifikasi tidak terbaca. Cek data lagi.");
  return value.flatMap((item): RekamMedisIdentityDecision[] => {
    if (!item || typeof item !== "object" || typeof item.source_key !== "string") return [];
    if (item.decision === "skip") return [{ source_key: item.source_key, decision: "skip" }];
    if (!item.decision || typeof item.decision !== "object" || typeof item.decision.customer_id !== "string") return [];
    return [{
      source_key: item.source_key,
      decision: {
        customer_id: item.decision.customer_id,
        pet_id: typeof item.decision.pet_id === "string" ? item.decision.pet_id : null,
      },
    }];
  });
}

function identityDecisions(formData: FormData): RekamMedisIdentityDecision[] {
  const raw = String(formData.get("identity_decisions") ?? "[]");
  try {
    return parseIdentityDecisions(JSON.parse(raw));
  } catch {
    throw new Error("Keputusan klarifikasi tidak terbaca. Cek data lagi.");
  }
}

function resolveIdentityDecisions(clarifications: RekamMedisIdentityClarification[], decisions: RekamMedisIdentityDecision[]) {
  const decisionBySource = new Map(decisions.map((item) => [item.source_key, item.decision]));
  const mappings = new Map<string, Exclude<RekamMedisIdentityDecision["decision"], "skip">>();
  const skipped = new Set<string>();
  for (const clarification of clarifications) {
    const decision = decisionBySource.get(clarification.source_key);
    if (!decision) throw new Error(`Pilih keputusan untuk ${clarification.source_file} — ${clarification.source_sheet}.`);
    if (decision === "skip") {
      skipped.add(clarification.source_key);
      continue;
    }
    const valid = clarification.candidates.some((candidate) => candidate.customer_id === decision.customer_id && candidate.pet_id === decision.pet_id);
    if (!valid) throw new Error(`Pilihan pemilik atau anabul untuk ${clarification.source_file} sudah berubah. Cek data lagi.`);
    mappings.set(clarification.source_key, decision);
  }
  return { mappings, skipped };
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

export async function previewImporRekamMedis(formData: FormData): Promise<RekamMedisImportState> {
  try {
    await assertBolehImpor();
    const result = await baca(formData);
    const supabase = await createClient();
    const clarifications = await loadIdentityClarifications(supabase, result.rows);
    return {
      ok: result.rows.length > 0,
      phase: "preview",
      message: result.rows.length
        ? `${result.rows.length} riwayat siap dicek. ${result.held.length} riwayat ditahan. ${clarifications.length} perlu keputusan.`
        : "Tidak ada riwayat yang aman untuk diimpor.",
      ...result,
      clarifications,
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
    const clarifications = await loadIdentityClarifications(supabase, result.rows);
    const decisions = resolveIdentityDecisions(clarifications, identityDecisions(formData));
    const rowsToImport = result.rows.filter((row) => !decisions.skipped.has(row.source_key));
    if (!bolehKonfirmasiImporRekamMedis(rowsToImport.length, true)) throw new Error("Tidak ada riwayat yang aman untuk diimpor.");

    const { data: existing, error: existingError } = await supabase
      .from("visits").select("legacy_source_key")
      .in("legacy_source_key", rowsToImport.map((row) => row.source_key));
    if (existingError) throw new Error(existingError.message);
    const { baru, sudah_ada } = pilahRiwayatTersimpan(
      rowsToImport,
      (existing ?? []).flatMap((row) => row.legacy_source_key ? [row.legacy_source_key] : []),
    );

    const importClient = supabase as unknown as ImportRpcClient;
    await jalankanTerbatasImporRekamMedis(baru, BERSAMAAN_SIMPAN, async (row) => {
      const mapping = decisions.mappings.get(row.source_key);
      const { error } = await importClient.rpc("import_legacy_medical_record_resolved", {
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
        p_customer_id: mapping?.customer_id ?? null,
        p_pet_id: mapping?.pet_id ?? null,
      });
      if (error) throw new Error(error.message);
    });
    revalidatePath("/klinik/antrian");
    revalidatePath("/crm/pelanggan");
    const existingMessage = sudah_ada ? ` ${sudah_ada} riwayat sudah ada dan tidak digandakan.` : "";
    const skippedMessage = decisions.skipped.size ? ` ${decisions.skipped.size} riwayat dipilih untuk tidak diimpor.` : "";
    return { ok: true, phase: "done", message: `${baru.length} riwayat baru berhasil disimpan.${existingMessage}${skippedMessage}`, ...result, clarifications };
  } catch (error) {
    return empty(error instanceof Error ? error.message : "Impor gagal.");
  }
}

export async function simpanBatchImporRekamMedis(
  input: RekamMedisImporRow[],
  decisionsInput: RekamMedisIdentityDecision[],
  approved: boolean,
  finalBatch = false,
): Promise<RekamMedisBatchResult> {
  try {
    const supabase = await assertBolehImpor();
    if (!approved) throw new Error("Centang persetujuan impor setelah meninjau hasil cek.");
    const rows = validasiRows(input);
    const decisions = parseIdentityDecisions(decisionsInput);
    const clarifications = await loadIdentityClarifications(supabase, rows);
    const resolved = resolveIdentityDecisions(clarifications, decisions);
    const rowsToImport = rows.filter((row) => !resolved.skipped.has(row.source_key));
    if (!rowsToImport.length) {
      return { ok: true, message: "Tidak ada riwayat baru di batch ini.", tersimpan: 0, sudah_ada: 0, dilewati: resolved.skipped.size };
    }

    const { data: existing, error: existingError } = await supabase
      .from("visits").select("legacy_source_key")
      .in("legacy_source_key", rowsToImport.map((row) => row.source_key));
    if (existingError) throw new Error(existingError.message);
    const { baru, sudah_ada } = pilahRiwayatTersimpan(
      rowsToImport,
      (existing ?? []).flatMap((row) => row.legacy_source_key ? [row.legacy_source_key] : []),
    );

    const importClient = supabase as unknown as ImportRpcClient;
    await jalankanTerbatasImporRekamMedis(baru, BERSAMAAN_SIMPAN, async (row) => {
      const mapping = resolved.mappings.get(row.source_key);
      const { error } = await importClient.rpc("import_legacy_medical_record_resolved", {
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
        p_customer_id: mapping?.customer_id ?? null,
        p_pet_id: mapping?.pet_id ?? null,
      });
      if (error) throw new Error(error.message);
    });
    if (finalBatch) {
      revalidatePath("/klinik/antrian");
      revalidatePath("/crm/pelanggan");
    }
    return {
      ok: true,
      message: `${baru.length} riwayat baru berhasil disimpan.`,
      tersimpan: baru.length,
      sudah_ada,
      dilewati: resolved.skipped.size,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Impor gagal.",
      tersimpan: 0,
      sudah_ada: 0,
      dilewati: 0,
    };
  }
}
