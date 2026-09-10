"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  bacaWorkbooksRekamMedis,
  bolehKonfirmasiImporRekamMedis,
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

export type RekamMedisImportState = {
  ok: boolean;
  phase: "preview" | "done";
  message: string;
  rows: RekamMedisImporRow[];
  held: RekamMedisImporHeld[];
  ignored_sheets: number;
  clarifications: RekamMedisIdentityClarification[];
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

type IdentityDecision = { source_key: string; decision: "skip" | { customer_id: string; pet_id: string | null } };

function identityDecisions(formData: FormData): IdentityDecision[] {
  const raw = String(formData.get("identity_decisions") ?? "[]");
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error();
    return parsed.flatMap((value): IdentityDecision[] => {
      if (!value || typeof value !== "object" || typeof value.source_key !== "string") return [];
      if (value.decision === "skip") return [{ source_key: value.source_key, decision: "skip" }];
      if (!value.decision || typeof value.decision !== "object" || typeof value.decision.customer_id !== "string") return [];
      return [{
        source_key: value.source_key,
        decision: {
          customer_id: value.decision.customer_id,
          pet_id: typeof value.decision.pet_id === "string" ? value.decision.pet_id : null,
        },
      }];
    });
  } catch {
    throw new Error("Keputusan klarifikasi tidak terbaca. Cek data lagi.");
  }
}

function resolveIdentityDecisions(clarifications: RekamMedisIdentityClarification[], decisions: IdentityDecision[]) {
  const decisionBySource = new Map(decisions.map((item) => [item.source_key, item.decision]));
  const mappings = new Map<string, Exclude<IdentityDecision["decision"], "skip">>();
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
    for (const row of baru) {
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
    }
    revalidatePath("/klinik/antrian");
    revalidatePath("/crm/pelanggan");
    const existingMessage = sudah_ada ? ` ${sudah_ada} riwayat sudah ada dan tidak digandakan.` : "";
    const skippedMessage = decisions.skipped.size ? ` ${decisions.skipped.size} riwayat dipilih untuk tidak diimpor.` : "";
    return { ok: true, phase: "done", message: `${baru.length} riwayat baru berhasil disimpan.${existingMessage}${skippedMessage}`, ...result, clarifications };
  } catch (error) {
    return empty(error instanceof Error ? error.message : "Impor gagal.");
  }
}
