"use server";

import { revalidatePath } from "next/cache";
import { readCompleteList } from "@/lib/checked-list";
import { createClient } from "@/lib/supabase/server";
import {
  bacaWorkbooksRekamMedis,
  bolehKonfirmasiImporRekamMedis,
  jalankanTerbatasImporRekamMedis,
  klarifikasiIdentitasRekamMedis,
  identitasPersisRekamMedis,
  kunciTeksImporRekamMedis,
  kunciTeleponImporRekamMedis,
  pilahRiwayatTersimpan,
  type RekamMedisExistingOwner,
  type RekamMedisExistingPet,
  type RekamMedisIdentityClarification,
  type RekamMedisImporHeld,
  type RekamMedisImporRow,
} from "@/lib/impor-rekam-medis";
import { bagiKirimanBaris, MAKS_BARIS_PER_KIRIMAN, MAKS_BARIS_POTONGAN_REKAM_MEDIS } from "@/lib/impor-rekam-medis-aliran";
import { barisHasilImpor, kunciPeriksaHasil, type HasilImporRekamMedis } from "@/lib/impor-rekam-medis-hasil";

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

async function loadIdentityPlan(supabase: Awaited<ReturnType<typeof createClient>>, rows: RekamMedisImporRow[]) {
  if (!rows.length) return { clarifications: [], mappings: new Map<string, { customer_id: string; pet_id: string | null }>() };
  const load = (table: "customers" | "pets", columns: string) => readCompleteList<{ id: string; [field: string]: unknown }>(async (from, to) => {
    const response = await supabase.from(table).select(columns, { count: "exact" }).order("id").range(from, to);
    return { ...response, data: response.data as unknown as { id: string; [field: string]: unknown }[] | null };
  }, "Identitas riwayat medis", { maxRows: null });
  const [ownerRows, petRows] = await Promise.all([
    load("customers", "id,name,phone"), load("pets", "id,customer_id,name"),
  ]);
  const owners = ownerRows.map(owner => ({ id: owner.id, name: String(owner.name ?? ""), phone: owner.phone ? String(owner.phone) : null }));
  const pets = petRows.map(pet => ({ id: pet.id, customer_id: String(pet.customer_id), name: String(pet.name ?? "") }));
  const mappings = new Map<string, { customer_id: string; pet_id: string | null }>();
  for (const row of rows) {
    const identity = identitasPersisRekamMedis(row, owners, pets);
    if (identity) mappings.set(row.source_key, identity);
  }
  return { clarifications: klarifikasiIdentitasRekamMedis(rows, owners, pets), mappings };
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


async function validasiMappingBatch(supabase: Awaited<ReturnType<typeof createClient>>, mappings: Map<string, { customer_id: string; pet_id: string | null }>) {
  const pilihan = [...mappings.values()];
  if (!pilihan.length) return;
  const customerIds = [...new Set(pilihan.map((item) => item.customer_id))];
  const petIds = [...new Set(pilihan.flatMap((item) => item.pet_id ? [item.pet_id] : []))];
  const [{ data: customers, error: customerError }, { data: pets, error: petError }] = await Promise.all([
    supabase.from("customers").select("id").in("id", customerIds),
    petIds.length ? supabase.from("pets").select("id,customer_id").in("id", petIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (customerError) throw new Error(customerError.message);
  if (petError) throw new Error(petError.message);
  const customersFound = new Set((customers ?? []).map((item) => String(item.id)));
  const petsFound = new Map((pets ?? []).map((item) => [String(item.id), String(item.customer_id)]));
  for (const item of pilihan) {
    if (!customersFound.has(item.customer_id)) throw new Error("Pemilik yang dipilih sudah tidak tersedia. Cek data lagi.");
    if (item.pet_id && petsFound.get(item.pet_id) !== item.customer_id) throw new Error("Anabul yang dipilih tidak cocok dengan pemilik. Cek data lagi.");
  }
}

async function prepareMedicalDelta(supabase: Awaited<ReturnType<typeof createClient>>, rows: RekamMedisImporRow[], decisions: RekamMedisIdentityDecision[]) {
  const sourceKeys = new Set(rows.map(row => row.source_key));
  const skipped = new Set(decisions.filter(item => item.decision === "skip" && sourceKeys.has(item.source_key)).map(item => item.source_key));
  const selected = rows.filter(row => !skipped.has(row.source_key));
  const existingKeys: string[] = [];
  // Bound each URL while also checking complete reads of stored source identities.
  for (let index = 0; index < selected.length; index += 50) {
    const keys = selected.slice(index, index + 50).map(row => row.source_key);
    const existing = await readCompleteList<{ id: string; legacy_source_key: string | null }>((from, to) => supabase
      .from("visits").select("id,legacy_source_key", { count: "exact" })
      .in("legacy_source_key", keys).order("id").range(from, to), "Riwayat medis tersimpan", { maxRows: null });
    existingKeys.push(...existing.flatMap(row => row.legacy_source_key ? [row.legacy_source_key] : []));
  }
  const { baru, tercatat } = pilahRiwayatTersimpan(selected, existingKeys);
  const { clarifications, mappings } = await loadIdentityPlan(supabase, baru);
  const resolved = resolveIdentityDecisions(clarifications, decisions);
  resolved.skipped = skipped;
  for (const [source, identity] of mappings) resolved.mappings.set(source, identity);
  await validasiMappingBatch(supabase, resolved.mappings);
  return { baru, tercatat, resolved, clarifications };
}

type ImportRpcArgs = Record<string, unknown>;

function argumenImporBaris(row: RekamMedisImporRow, mapping: { customer_id: string; pet_id: string | null } | undefined): ImportRpcArgs {
  return {
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
  };
}

/**
 * Jalur per baris (pratinjau berkas dan simpan batch). Baris `tercatat` dikirim juga:
 * database mengembalikan kunjungan yang sama bila isinya terbukti identik, dan menolak
 * dengan alasan bila isinya berbeda (K1b). Penolakan itu dihentikan di sini supaya tidak
 * ada yang dihitung "sudah ada" tanpa bukti.
 */
async function simpanPerBarisRekamMedis(
  supabase: Awaited<ReturnType<typeof createClient>>,
  baru: RekamMedisImporRow[],
  tercatat: RekamMedisImporRow[],
  mappings: Map<string, { customer_id: string; pet_id: string | null }>,
) {
  const importClient = supabase as unknown as ImportRpcClient;
  for (const row of tercatat) {
    const { error } = await importClient.rpc("import_legacy_medical_record_resolved", argumenImporBaris(row, undefined));
    if (error) throw new Error(`${row.source_file} — ${row.source_sheet}: ${error.message}`);
  }
  await jalankanTerbatasImporRekamMedis(baru, BERSAMAAN_SIMPAN, async (row) => {
    const { error } = await importClient.rpc("import_legacy_medical_record_resolved", argumenImporBaris(row, mappings.get(row.source_key)));
    if (error) throw new Error(error.message);
  });
}

function cleanText(value: unknown, max: number): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function validasiRows(input: unknown, maksBaris = 50): RekamMedisImporRow[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error("Tidak ada riwayat yang siap disimpan.");
  if (input.length > maksBaris) throw new Error("Terlalu banyak riwayat dalam satu kiriman.");
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
    const { clarifications } = await loadIdentityPlan(supabase, result.rows);
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
    if (!bolehKonfirmasiImporRekamMedis(result.rows.length, true)) throw new Error("Tidak ada riwayat yang aman untuk diimpor.");
    const { baru, tercatat, resolved: decisions, clarifications } = await prepareMedicalDelta(supabase, result.rows, identityDecisions(formData));

    await simpanPerBarisRekamMedis(supabase, baru, tercatat, decisions.mappings);
    revalidatePath("/klinik/antrian");
    revalidatePath("/crm/pelanggan");
    const existingMessage = tercatat.length ? ` ${tercatat.length} riwayat sudah ada (isinya terbukti sama) dan tidak digandakan.` : "";
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
    const { baru, tercatat, resolved } = await prepareMedicalDelta(supabase, rows, decisions);

    await simpanPerBarisRekamMedis(supabase, baru, tercatat, resolved.mappings);
    if (finalBatch) {
      revalidatePath("/klinik/antrian");
      revalidatePath("/crm/pelanggan");
    }
    return {
      ok: true,
      message: `${baru.length} riwayat baru berhasil disimpan.`,
      tersimpan: baru.length,
      sudah_ada: tercatat.length,
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

// ---------------------------------------------------------------------------
// Jalur mengalir: satu permintaan per potongan folder, satu transaksi per kiriman
// ---------------------------------------------------------------------------

type PemindaiRpcClient = {
  rpc: (name: "import_legacy_identity_scan" | "import_legacy_medical_records_bulk" | "hasil_impor_rekam_medis", args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type HasilPotonganImporRekamMedis = {
  ok: boolean;
  message: string;
  tersimpan: number;
  sudah_ada: number;
  dilewati: number;
  ditahan: RekamMedisImporHeld[];
  perlu_keputusan: RekamMedisIdentityClarification[];
  /** Jejak yang dinyatakan database tersimpan atau sudah ada, untuk "Periksa hasil impor". */
  kunci_tersimpan: string[];
};

const potonganKosong = (message: string): HasilPotonganImporRekamMedis => ({
  ok: false, message, tersimpan: 0, sudah_ada: 0, dilewati: 0, ditahan: [], perlu_keputusan: [], kunci_tersimpan: [],
});

function pesanRpc(message: string) {
  if (/does not exist|could not find the function|schema cache/i.test(message)) {
    return "Database belum diperbarui untuk impor cepat. Hubungi tim teknis sebelum mengulang.";
  }
  return message;
}

/**
 * Satu panggilan: riwayat mana yang sudah pernah diimpor, dan siapa saja calon pemilik/anabul
 * yang relevan untuk potongan ini. Penyaring di database sengaja lebih luas daripada aturan
 * aplikasi, jadi keputusan "mirip -> tanya manusia" tetap diambil oleh kode yang sudah teruji.
 */
async function pindaiIdentitasPotongan(supabase: Awaited<ReturnType<typeof createClient>>, rows: RekamMedisImporRow[]) {
  const kosong = { existing: [] as string[], owners: [] as RekamMedisExistingOwner[], pets: [] as RekamMedisExistingPet[] };
  if (!rows.length) return kosong;
  const { data, error } = await (supabase as unknown as PemindaiRpcClient).rpc("import_legacy_identity_scan", {
    p_source_keys: [...new Set(rows.map((row) => row.source_key))],
    p_owner_keys: [...new Set(rows.map((row) => kunciTeksImporRekamMedis(row.owner_name)))],
    p_phone_keys: [...new Set(rows.map((row) => kunciTeleponImporRekamMedis(row.phone)))],
  });
  if (error) throw new Error(pesanRpc(error.message));
  if (!data || typeof data !== "object") throw new Error("Pemeriksaan identitas tidak memberi jawaban. Coba lagi.");
  const payload = data as { sudah_ada?: unknown; customers?: unknown; pets?: unknown };
  const list = (value: unknown) => Array.isArray(value) ? value : [];
  return {
    existing: list(payload.sudah_ada).flatMap((item) => typeof item === "string" ? [item] : []),
    owners: list(payload.customers).flatMap((item): RekamMedisExistingOwner[] => {
      const owner = item as { id?: unknown; name?: unknown; phone?: unknown };
      return typeof owner?.id === "string" ? [{ id: owner.id, name: String(owner.name ?? ""), phone: owner.phone == null ? null : String(owner.phone) }] : [];
    }),
    pets: list(payload.pets).flatMap((item): RekamMedisExistingPet[] => {
      const pet = item as { id?: unknown; customer_id?: unknown; name?: unknown };
      return typeof pet?.id === "string" && typeof pet?.customer_id === "string"
        ? [{ id: pet.id, customer_id: pet.customer_id, name: String(pet.name ?? "") }]
        : [];
    }),
  };
}

type StatusBarisMassal = { source_key: string; status: string; reason: string | null };

/** Satu transaksi per kiriman; pengulangan aman karena kunci sumber unik di database. */
async function simpanMassalRekamMedis(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: RekamMedisImporRow[],
  mappings: Map<string, { customer_id: string; pet_id: string | null }>,
) {
  const status: StatusBarisMassal[] = [];
  for (const kiriman of bagiKirimanBaris(rows, MAKS_BARIS_PER_KIRIMAN)) {
    const payload = kiriman.map((row) => {
      const mapping = mappings.get(row.source_key);
      return {
        source_key: row.source_key,
        record_no: row.record_no,
        record_date: `${row.record_date}T00:00:00+07:00`,
        owner_name: row.owner_name,
        phone: row.phone,
        address: row.address,
        patient_name: row.patient_name,
        species: row.species,
        breed: row.breed,
        gender: row.gender,
        dob: row.dob,
        doctor: row.doctor,
        note: row.note,
        anamnesis: row.anamnesis,
        clinical_findings: row.clinical_findings,
        diagnosis: row.diagnosis,
        therapy: row.therapy,
        customer_id: mapping?.customer_id ?? null,
        pet_id: mapping?.pet_id ?? null,
      };
    });
    const { data, error } = await (supabase as unknown as PemindaiRpcClient).rpc("import_legacy_medical_records_bulk", { p_rows: payload });
    if (error) throw new Error(pesanRpc(error.message));
    if (!Array.isArray(data)) throw new Error("Penyimpanan tidak memberi jawaban per riwayat. Coba lagi.");
    if (data.length !== kiriman.length) throw new Error("Penyimpanan tidak melaporkan semua riwayat. Coba lagi.");
    for (const item of data as Array<Record<string, unknown>>) {
      status.push({
        source_key: String(item?.source_key ?? ""),
        status: String(item?.status ?? "ditahan"),
        reason: item?.reason == null ? null : String(item.reason),
      });
    }
  }
  return status;
}

/**
 * Memproses satu potongan folder: cek yang sudah ada, selesaikan identitas yang jelas,
 * simpan massal, dan KEMBALIKAN -- bukan melempar -- pertanyaan identitas yang masih
 * perlu keputusan manusia supaya aliran impor tidak berhenti di tengah folder.
 */
export async function prosesPotonganImporRekamMedis(
  input: RekamMedisImporRow[],
  decisionsInput: RekamMedisIdentityDecision[],
  approved: boolean,
  revalidate = false,
): Promise<HasilPotonganImporRekamMedis> {
  try {
    const supabase = await assertBolehImpor();
    if (!approved) throw new Error("Centang persetujuan impor setelah meninjau hasil cek.");
    const rows = validasiRows(input, MAKS_BARIS_POTONGAN_REKAM_MEDIS);
    const decisions = parseIdentityDecisions(decisionsInput);
    const keputusan = new Map(decisions.map((item) => [item.source_key, item.decision]));

    const dilewati = rows.filter((row) => keputusan.get(row.source_key) === "skip").length;
    const dipilih = rows.filter((row) => keputusan.get(row.source_key) !== "skip");

    const pindai = await pindaiIdentitasPotongan(supabase, dipilih);
    // Jejak yang sudah tercatat tetap dikirim: hanya database yang bisa membuktikan isinya
    // identik (K1b). Baris itu tidak akan dibuat baru, jadi tidak perlu pilihan identitas.
    const { baru, tercatat } = pilahRiwayatTersimpan(dipilih, pindai.existing);

    const mappings = new Map<string, { customer_id: string; pet_id: string | null }>();
    for (const row of baru) {
      const identity = identitasPersisRekamMedis(row, pindai.owners, pindai.pets);
      if (identity) mappings.set(row.source_key, identity);
    }

    const ditahan: RekamMedisImporHeld[] = [];
    const perluKeputusan: RekamMedisIdentityClarification[] = [];
    const tertunda = new Set<string>();
    for (const clarification of klarifikasiIdentitasRekamMedis(baru, pindai.owners, pindai.pets)) {
      const decision = keputusan.get(clarification.source_key);
      if (!decision) {
        perluKeputusan.push(clarification);
        tertunda.add(clarification.source_key);
        continue;
      }
      if (decision === "skip") continue;
      const valid = clarification.candidates.some((candidate) => candidate.customer_id === decision.customer_id && candidate.pet_id === decision.pet_id);
      if (!valid) {
        ditahan.push({
          source_key: clarification.source_key,
          source_file: clarification.source_file,
          source_sheet: clarification.source_sheet,
          reason: "Pilihan pemilik atau anabul sudah berubah. Pilih ulang lalu simpan lagi.",
        });
        tertunda.add(clarification.source_key);
        continue;
      }
      mappings.set(clarification.source_key, decision);
    }

    const kirim = [...tercatat, ...baru.filter((row) => !tertunda.has(row.source_key))];
    const status = await simpanMassalRekamMedis(supabase, kirim, mappings);
    const perBaris = new Map(kirim.map((row) => [row.source_key, row]));
    let tersimpan = 0;
    let sudahAda = 0;
    const kunciTersimpan: string[] = [];
    for (const item of status) {
      if (item.status === "tersimpan" || item.status === "sudah_ada") {
        if (item.status === "tersimpan") tersimpan += 1;
        else sudahAda += 1;
        kunciTersimpan.push(item.source_key);
      } else {
        const row = perBaris.get(item.source_key);
        ditahan.push({
          source_key: item.source_key,
          source_file: row?.source_file ?? "—",
          source_sheet: row?.source_sheet ?? "—",
          reason: item.reason ?? "Riwayat ditolak database.",
        });
      }
    }

    if (revalidate && tersimpan > 0) {
      revalidatePath("/klinik/antrian");
      revalidatePath("/crm/pelanggan");
    }
    return {
      ok: true,
      message: `${tersimpan} riwayat baru disimpan, ${sudahAda} sudah ada, ${ditahan.length} ditahan, ${perluKeputusan.length} perlu keputusan.`,
      tersimpan,
      sudah_ada: sudahAda,
      dilewati,
      ditahan,
      perlu_keputusan: perluKeputusan,
      kunci_tersimpan: kunciTersimpan,
    };
  } catch (error) {
    return potonganKosong(error instanceof Error ? error.message : "Potongan impor gagal diproses.");
  }
}

export type HasilPeriksaImporRekamMedis = {
  ok: boolean;
  message: string;
  diminta: number;
  rows: HasilImporRekamMedis[];
};

/**
 * Periksa hasil impor di cabang aktif (RS-1): riwayat bersama tidak tampil di halaman pasien saat
 * cabang dipilih, jadi layar impor membacanya lewat RPC baca-saja yang dibatasi database
 * (OWNER/ADMIN aktif, header cabang tetap dikirim, maks. 500 jejak, hanya riwayat tanpa cabang).
 */
export async function periksaHasilImporRekamMedis(kunciInput: string[]): Promise<HasilPeriksaImporRekamMedis> {
  try {
    const supabase = await assertBolehImpor();
    const kunci = kunciPeriksaHasil(kunciInput);
    const { data, error } = await (supabase as unknown as PemindaiRpcClient).rpc("hasil_impor_rekam_medis", { p_keys: kunci });
    if (error) throw new Error(pesanRpc(error.message));
    const rows = barisHasilImpor(data);
    const ditemukan = new Set(rows.map((row) => row.kunci)).size;
    return {
      ok: true,
      message: `${ditemukan} dari ${kunci.length} riwayat ditemukan di riwayat bersama.`,
      diminta: kunci.length,
      rows,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Hasil impor gagal diperiksa.", diminta: 0, rows: [] };
  }
}
