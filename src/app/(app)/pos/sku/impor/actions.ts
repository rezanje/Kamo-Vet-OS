"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { bacaCsv, periksaBaris, type BarisSalah, type MasterImpor } from "@/lib/impor-barang";
import { pesanSimpanGagal } from "@/lib/barang";
import {
  bacaWorkbookKategoriAccurate,
  bacaWorkbookAccurate,
  buatPayloadItemAccurate,
  buatPreviewAccurate,
  rencanaIndukKategoriAccurate,
  type AccurateCategory,
  type AccurateIssue,
  type AccurateItem,
  type AccuratePreviewRow,
  type AccuratePreviewStatus,
  type ExistingAccurateCategory,
  type ExistingAccurateItem,
} from "@/lib/impor-accurate";
import {
  bacaWorkbookKomponenGrup,
  fingerprintInput,
  groupComponentPayload,
  parseKomponenGrupRows,
  type GroupMasterLite,
} from "@/lib/impor-accurate-lanjutan";
import {
  bacaWorkbookSaldoAwal,
  reconcileInitialStock,
  resolveSaldoAwalRows,
  type ResolvedSaldoAwal,
  type SaldoAwalMasterItem,
} from "@/lib/impor-saldo-accurate";

const BACK = "/pos/sku/impor";

async function assertBolehKelola() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER" && profile?.role !== "ADMIN") {
    redirect(`${BACK}?error=${encodeURIComponent("Hanya OWNER/ADMIN yang boleh mengimpor barang")}`);
  }
  return supabase;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function muatMaster(supabase: any): Promise<MasterImpor> {
  const [{ data: kat }, { data: merek }, { data: satuan }, { data: items }] = await Promise.all([
    supabase.from("item_categories").select("id, name").eq("is_active", true),
    supabase.from("brands").select("id, name"),
    supabase.from("units").select("nama").eq("is_active", true),
    supabase.from("items").select("code"),
  ]);

  return {
    kategori: new Map(((kat ?? []) as { id: string; name: string }[]).map((k) => [k.name.toLowerCase(), k.id])),
    merek: new Map(((merek ?? []) as { id: string; name: string }[]).map((b) => [b.name.toLowerCase(), b.id])),
    satuan: new Set(((satuan ?? []) as { nama: string }[]).map((u) => u.nama.toLowerCase())),
    kodeTerpakai: new Set(((items ?? []) as { code: string | null }[])
      .map((i) => (i.code ?? "").toLowerCase()).filter(Boolean)),
  };
}

/** Ringkas baris bermasalah jadi satu pesan yang muat di URL. */
function ringkasSalah(salah: BarisSalah[]): string {
  const tampil = salah.slice(0, 8).map((s) => `baris ${s.no} (${s.kode}): ${s.pesan}`);
  const sisa = salah.length - tampil.length;
  return tampil.join(" · ") + (sisa > 0 ? ` · dan ${sisa} baris lain` : "");
}

export async function imporBarang(formData: FormData) {
  const supabase = await assertBolehKelola();
  const gagal = (pesan: string) => redirect(`${BACK}?error=${encodeURIComponent(pesan)}`);

  const isi = String(formData.get("csv") ?? "");
  if (!isi.trim()) gagal("Belum ada file atau isian CSV.");

  const dibaca = bacaCsv(isi);
  if (!dibaca.ok) gagal(dibaca.pesan);
  if (!dibaca.ok) return; // penyempit tipe; redirect di atas tidak pernah balik

  const { siap, salah } = periksaBaris(dibaca.baris, await muatMaster(supabase));

  // Tidak ada satu pun baris yang bisa masuk — kembalikan daftar masalahnya utuh,
  // jangan "berhasil 0 barang" yang bikin pemakai kira filenya sudah beres.
  if (siap.length === 0) {
    gagal(`Tidak ada baris yang bisa disimpan. ${ringkasSalah(salah)}`);
  }

  const { error } = await supabase.from("items").insert(
    siap.map((b) => ({ ...b, is_active: true })),
  );
  if (error) gagal(pesanSimpanGagal(error.message));

  const pesan = salah.length === 0
    ? `${siap.length} barang berhasil diimpor.`
    : `${siap.length} barang diimpor, ${salah.length} baris dilewati — ${ringkasSalah(salah)}`;

  redirect(`/pos/sku?success=${encodeURIComponent(pesan)}`);
}

const MAX_XLSX_BYTES = 15 * 1024 * 1024;
const PAGE_SIZE = 1_000;

export type AccurateImportState = {
  ok: boolean;
  phase: "preview" | "done";
  message: string;
  hierarchy_count: number;
  rows: AccuratePreviewRow[];
  summary: Record<AccuratePreviewStatus, number>;
  new_masters: {
    categories: string[];
    brands: string[];
    units: string[];
    suppliers: string[];
  };
  run_id: string | null;
  source_hash: string | null;
  source_fingerprint: string | null;
};

export type GroupImportState = {
  ok: boolean;
  phase: "preview" | "done";
  message: string;
  complete: number;
  incomplete: number;
  rejected: number;
  unknown: number;
  errors: string[];
};

export type InitialStockCheck = {
  label: "Qty stok" | "Qty layer" | "Qty kartu" | "Nilai layer";
  ok: boolean;
  difference: number;
};

export type InitialStockRow = ResolvedSaldoAwal & { itemName: string | null };

export type InitialStockState = {
  ok: boolean;
  phase: "preview" | "done";
  message: string;
  branch_id: string | null;
  warehouse_id: string | null;
  as_of: string | null;
  run_id: string | null;
  source_hash: string | null;
  rows: InitialStockRow[];
  source_qty: number;
  source_value: number;
  checks: InitialStockCheck[];
};

type MasterAccurate = {
  items: ExistingAccurateItem[];
  categories: Map<string, ExistingAccurateCategory>;
  brands: Map<string, string>;
  units: Map<string, string>;
  suppliers: Map<string, string>;
};

const emptySummary = (): Record<AccuratePreviewStatus, number> => ({
  Baru: 0,
  Update: 0,
  Sama: 0,
  Dilewati: 0,
  Ditolak: 0,
});

function stateError(message: string): AccurateImportState {
  return {
    ok: false,
    phase: "preview",
    message,
    hierarchy_count: 0,
    rows: [],
    summary: emptySummary(),
    new_masters: { categories: [], brands: [], units: [], suppliers: [] },
    run_id: null,
    source_hash: null,
    source_fingerprint: null,
  };
}

function groupStateError(message: string): GroupImportState {
  return { ok: false, phase: "preview", message, complete: 0, incomplete: 0, rejected: 0, unknown: 0, errors: [] };
}

function initialStockStateError(message: string): InitialStockState {
  return {
    ok: false,
    phase: "preview",
    message,
    branch_id: null,
    warehouse_id: null,
    as_of: null,
    run_id: null,
    source_hash: null,
    rows: [],
    source_qty: 0,
    source_value: 0,
    checks: [],
  };
}

function summarize(rows: AccuratePreviewRow[]) {
  const summary = emptySummary();
  rows.forEach((row) => { summary[row.status] += 1; });
  return summary;
}

function getUploads(formData: FormData): File[] {
  const submitted = formData.getAll("files");
  const files = (submitted.length ? submitted : [formData.get("file")])
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (!files.length) throw new Error("Pilih minimal satu file Accurate .xlsx terlebih dulu.");
  if (files.some((file) => !file.name.toLowerCase().endsWith(".xlsx"))) {
    throw new Error("Semua file harus berformat .xlsx.");
  }
  if (files.some((file) => file.size > MAX_XLSX_BYTES)) throw new Error("Ukuran tiap file maksimal 15 MB.");
  return files;
}

function getCategoryUpload(formData: FormData): File | null {
  const file = formData.get("category_file");
  if (!(file instanceof File) || file.size === 0) return null;
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("File kategori harus berformat .xlsx.");
  if (file.size > 1024 * 1024) throw new Error("Ukuran file kategori maksimal 1 MB.");
  return file;
}

// Supabase membatasi select per 1.000 baris. Master saat ini >4.000 SKU, jadi
// preview wajib dipaginasi agar kode lama setelah baris 1.000 tidak salah dianggap baru.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadAll(supabase: any, table: string, columns: string): Promise<any[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return rows;
}

function relationName(value: unknown, field: "name" | "nama"): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const name = (row as Record<string, unknown>)[field];
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function muatMasterAccurate(supabase: any): Promise<MasterAccurate> {
  const [itemRows, categoryRows, brandRows, unitRows, supplierRows] = await Promise.all([
    loadAll(supabase, "items", [
      "id", "code", "name", "item_type", "unit", "sell_price", "buy_price", "min_stock",
      "buy_unit", "min_buy", "upc", "track_expiry", "default_discount", "is_active",
      "category:item_categories(name)", "brand:brands(name)", "supplier:suppliers(nama)",
      "units:item_units(unit,factor,sell_price,buy_price)",
    ].join(",")),
    loadAll(supabase, "item_categories", "id,name,parent_id"),
    loadAll(supabase, "brands", "id,name"),
    loadAll(supabase, "units", "id,nama"),
    loadAll(supabase, "suppliers", "id,nama"),
  ]);

  const items: ExistingAccurateItem[] = itemRows.map((row) => ({
    id: String(row.id),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    item_type: row.item_type,
    category_name: relationName(row.category, "name") ?? "",
    brand_name: relationName(row.brand, "name"),
    unit: String(row.unit ?? ""),
    sell_price: Number(row.sell_price ?? 0),
    buy_price: Number(row.buy_price ?? 0),
    min_stock: Number(row.min_stock ?? 0),
    supplier_name: relationName(row.supplier, "nama"),
    buy_unit: row.buy_unit ? String(row.buy_unit) : null,
    min_buy: Number(row.min_buy ?? 0),
    upc: row.upc ? String(row.upc) : null,
    track_expiry: Boolean(row.track_expiry),
    default_discount: Number(row.default_discount ?? 0),
    is_active: Boolean(row.is_active),
    units: (row.units ?? []).map((unit: Record<string, unknown>) => ({
      unit: String(unit.unit ?? ""),
      factor: Number(unit.factor ?? 0),
      sell_price: Number(unit.sell_price ?? 0),
      buy_price: Number(unit.buy_price ?? 0),
    })),
  }));
  const toMap = (rows: Record<string, unknown>[], nameField: "name" | "nama") => new Map(
    rows.map((row) => [String(row[nameField] ?? "").trim().toLowerCase(), String(row.id)] as const)
      .filter(([name]) => Boolean(name)),
  );
  return {
    items,
    categories: new Map(categoryRows.map((row) => {
      const category: ExistingAccurateCategory = {
        id: String(row.id),
        name: String(row.name ?? "").trim(),
        parent_id: row.parent_id ? String(row.parent_id) : null,
      };
      return [category.name.toLowerCase(), category] as const;
    }).filter(([name]) => Boolean(name))),
    brands: toMap(brandRows, "name"),
    units: toMap(unitRows, "nama"),
    suppliers: toMap(supplierRows, "nama"),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function muatMasterGrup(supabase: any): Promise<Map<string, GroupMasterLite>> {
  const master = await muatMasterAccurate(supabase);
  return new Map(master.items.map((item) => [item.code.trim().toUpperCase(), {
    id: item.id,
    itemType: item.item_type,
    unit: item.unit,
    isActive: item.is_active,
    trackExpiry: item.track_expiry,
    units: item.units.map((unit) => ({ unit: unit.unit, factor: unit.factor })),
  }]));
}

async function bacaUploads(files: File[]): Promise<{
  parsed: { rows: AccurateItem[]; skipped: AccurateIssue[]; rejected: AccurateIssue[]; errors: string[] };
  bytes: { name: string; data: Uint8Array }[];
}> {
  const parsed = await Promise.all(files.map(async (file) => ({
    file,
    data: new Uint8Array(await file.arrayBuffer()),
  })));
  const results = await Promise.all(parsed.map(async ({ file, data }) => ({
    file,
    data,
    result: await bacaWorkbookAccurate(data),
  })));
  const rows = results.flatMap(({ file, result }) => result.rows.map((row) => ({
    ...row,
    source: `${file.name}:${row.row_no}`,
  })));
  const counts = new Map<string, number>();
  for (const row of rows) {
    const code = row.code.trim().toLowerCase();
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const duplicateCodes = new Set([...counts].filter(([, count]) => count > 1).map(([code]) => code));
  const crossFileRejected: AccurateIssue[] = rows
    .filter((row) => duplicateCodes.has(row.code.trim().toLowerCase()))
    .map((row) => ({
      row_no: row.row_no,
      code: row.code,
      name: row.name,
      reason: "Kode kembar lintas-file",
      source: row.source,
    }));
  return {
    parsed: {
      rows: rows.filter((row) => !duplicateCodes.has(row.code.trim().toLowerCase())),
      skipped: results.flatMap(({ file, result }) => result.skipped.map((row) => ({ ...row, source: `${file.name}:${row.row_no}` }))),
      rejected: [
        ...results.flatMap(({ file, result }) => result.rejected.map((row) => ({ ...row, source: `${file.name}:${row.row_no}` }))),
        ...crossFileRejected,
      ],
      errors: results.flatMap(({ file, result }) => result.errors.map((error) => `${file.name}: ${error}`)),
    },
    bytes: results.map(({ file, data }) => ({ name: file.name, data })),
  };
}

async function hashFiles(parts: { name: string; data: Uint8Array }[]) {
  const hash = createHash("sha256");
  for (const part of [...parts].sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(part.name);
    hash.update("\0");
    hash.update(String(part.data.byteLength));
    hash.update("\0");
    hash.update(part.data);
  }
  return hash.digest("hex");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findOrCreateImportRun(supabase: any, input: {
  sourceName: string;
  sourceHash: string;
  summary: Record<string, number>;
  rows: AccuratePreviewRow[];
}) {
  const existing = await supabase.from("import_runs")
    .select("id, status").eq("kind", "master_accurate").eq("source_hash", input.sourceHash).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    if (existing.data.status !== "previewed") throw new Error("Batch file yang sama sudah pernah diposting.");
    return String(existing.data.id);
  }
  const inserted = await supabase.from("import_runs").insert({
    kind: "master_accurate",
    source_name: input.sourceName,
    source_hash: input.sourceHash,
    summary: input.summary,
    created_by: (await supabase.auth.getUser()).data.user?.id,
  }).select("id").single();
  if (inserted.error) throw new Error(inserted.error.message);
  const rowPayload = input.rows.map((row) => ({
    run_id: inserted.data.id,
    source_row: row.row_no,
    source_code: row.code,
    status: row.status === "Baru" || row.status === "Update" ? "valid" : row.status === "Sama" ? "same" : row.status === "Dilewati" ? "skipped" : "rejected",
    reason: row.reason,
    payload: row,
  }));
  if (rowPayload.length) {
    const rowsInserted = await supabase.from("import_run_rows").insert(rowPayload);
    if (rowsInserted.error) throw new Error(rowsInserted.error.message);
  }
  return String(inserted.data.id);
}

function uniqueMissing(values: (string | null)[], existing: ReadonlyMap<string, unknown>) {
  const missing = new Map<string, string>();
  values.forEach((value) => {
    const clean = value?.trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (!existing.has(key) && !missing.has(key)) missing.set(key, clean);
  });
  return [...missing.values()].sort((a, b) => a.localeCompare(b));
}

function newMasters(items: AccurateItem[], master: MasterAccurate, categories: AccurateCategory[] = []) {
  const units = items.flatMap((item) => [
    item.unit,
    item.buy_unit,
    ...item.units.map((unit) => unit.unit),
  ]);
  return {
    categories: uniqueMissing([
      ...categories.map((row) => row.name),
      ...items.map((item) => item.category_name),
    ], master.categories),
    brands: uniqueMissing(items.map((item) => item.brand_name), master.brands),
    units: uniqueMissing(units, master.units),
    suppliers: uniqueMissing(items.map((item) => item.supplier_name), master.suppliers),
  };
}

export async function previewImporAccurate(formData: FormData): Promise<AccurateImportState> {
  try {
    const supabase = await assertBolehKelola();
    const files = getUploads(formData);
    const categoryFile = getCategoryUpload(formData);
    const upload = await bacaUploads(files);
    const parsed = upload.parsed;
    if (parsed.errors.length) return stateError(parsed.errors.join(" "));
    const parsedCategories = categoryFile
      ? await bacaWorkbookKategoriAccurate(new Uint8Array(await categoryFile.arrayBuffer()))
      : { rows: [], errors: [] };
    if (parsedCategories.errors.length) return stateError(parsedCategories.errors.join(" "));
    const master = await muatMasterAccurate(supabase);
    const rows = buatPreviewAccurate(parsed, master.items);
    const hierarchyCount = parsedCategories.rows.filter((row) => row.parent_name).length;
    const categoryBytes = categoryFile ? [{ name: `category:${categoryFile.name}`, data: new Uint8Array(await categoryFile.arrayBuffer()) }] : [];
    const sourceParts = [...upload.bytes, ...categoryBytes];
    const sourceHash = await hashFiles(sourceParts);
    const summary = summarize(rows);
    const runId = await findOrCreateImportRun(supabase, {
      sourceName: sourceParts.map((part) => part.name).sort().join(", "),
      sourceHash,
      summary,
      rows,
    });
    return {
      ok: true,
      phase: "preview",
      message: `${parsed.rows.length} baris valid diperiksa dari ${files.length} file. ${hierarchyCount} relasi subkategori ditemukan. Stok tidak diimpor.`,
      hierarchy_count: hierarchyCount,
      rows,
      summary,
      new_masters: newMasters(parsed.rows, master, parsedCategories.rows),
      run_id: runId,
      source_hash: sourceHash,
      source_fingerprint: fingerprintInput(sourceParts.map((part) => ({ name: part.name, size: part.data.byteLength }))),
    };
  } catch (error) {
    return stateError(error instanceof Error ? error.message : "File gagal dibaca.");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureCategory(supabase: any, master: MasterAccurate, name: string) {
  const key = name.toLowerCase();
  const existing = master.categories.get(key);
  if (existing) return existing.id;
  const { data, error } = await supabase.from("item_categories")
    .insert({ name, parent_id: null, is_active: true }).select("id").single();
  if (error) throw new Error(pesanSimpanGagal(error.message));
  const id = String(data.id);
  master.categories.set(key, { id, name, parent_id: null });
  return id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureBrand(supabase: any, master: MasterAccurate, name: string | null) {
  if (!name) return null;
  const key = name.toLowerCase();
  const existing = master.brands.get(key);
  if (existing) return existing;
  const { data, error } = await supabase.from("brands")
    .insert({ name, is_active: true }).select("id").single();
  if (error) throw new Error(pesanSimpanGagal(error.message));
  master.brands.set(key, data.id);
  return String(data.id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureSupplier(supabase: any, master: MasterAccurate, name: string | null) {
  if (!name) return null;
  const key = name.toLowerCase();
  const existing = master.suppliers.get(key);
  if (existing) return existing;
  const { data, error } = await supabase.from("suppliers").insert({ nama: name }).select("id").single();
  if (error) throw new Error(pesanSimpanGagal(error.message));
  master.suppliers.set(key, data.id);
  return String(data.id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureUnit(supabase: any, master: MasterAccurate, name: string | null) {
  if (!name) return;
  const key = name.toLowerCase();
  if (master.units.has(key)) return;
  const { data, error } = await supabase.from("units")
    .insert({ nama: name, is_active: true }).select("id").single();
  if (error) throw new Error(pesanSimpanGagal(error.message));
  master.units.set(key, String(data.id));
}

export async function konfirmasiImporAccurate(formData: FormData): Promise<AccurateImportState> {
  try {
    const supabase = await assertBolehKelola();
    const files = getUploads(formData);
    const categoryFile = getCategoryUpload(formData);
    const upload = await bacaUploads(files);
    const parsed = upload.parsed;
    if (parsed.errors.length) return stateError(parsed.errors.join(" "));
    const parsedCategories = categoryFile
      ? await bacaWorkbookKategoriAccurate(new Uint8Array(await categoryFile.arrayBuffer()))
      : { rows: [], errors: [] };
    if (parsedCategories.errors.length) return stateError(parsedCategories.errors.join(" "));
    const categoryBytes = categoryFile ? [{ name: `category:${categoryFile.name}`, data: new Uint8Array(await categoryFile.arrayBuffer()) }] : [];
    const sourceParts = [...upload.bytes, ...categoryBytes];
    const sourceHash = await hashFiles(sourceParts);
    const runId = String(formData.get("run_id") ?? "");
    if (!runId) return stateError("Preview impor sudah kedaluwarsa. Jalankan cek perubahan lagi.");
    const run = await supabase.from("import_runs").select("id, kind, source_hash, status")
      .eq("id", runId).maybeSingle();
    if (run.error) return stateError(run.error.message);
    if (!run.data || run.data.kind !== "master_accurate" || run.data.source_hash !== sourceHash || run.data.status !== "previewed") {
      return stateError("File berubah atau batch sudah diposting. Jalankan cek perubahan lagi.");
    }
    const master = await muatMasterAccurate(supabase);

    for (const category of parsedCategories.rows) {
      await ensureCategory(supabase, master, category.name);
    }
    const categoryUpdates = rencanaIndukKategoriAccurate(
      parsedCategories.rows,
      [...master.categories.values()],
    );
    for (const update of categoryUpdates) {
      const { error } = await supabase.from("item_categories")
        .update({ parent_id: update.parent_id }).eq("id", update.id);
      if (error) throw new Error(pesanSimpanGagal(error.message));
      const category = [...master.categories.values()].find((row) => row.id === update.id);
      if (category) category.parent_id = update.parent_id;
    }

    const initialPreview = buatPreviewAccurate(parsed, master.items);
    const statusByRow = new Map(initialPreview.map((row) => [row.row_no, row.status]));
    const existingByCode = new Map(master.items.map((item) => [item.code.toLowerCase(), item]));
    const resultRows: AccuratePreviewRow[] = initialPreview.filter(
      (row) => row.status === "Dilewati" || row.status === "Ditolak",
    );

    for (const item of parsed.rows) {
      const status = statusByRow.get(item.row_no) ?? "Baru";
      if (status === "Sama") {
        resultRows.push({ row_no: item.row_no, code: item.code, name: item.name, status, changed_fields: [], reason: null });
        continue;
      }
      try {
        const [categoryId, brandId, supplierId] = await Promise.all([
          ensureCategory(supabase, master, item.category_name),
          ensureBrand(supabase, master, item.brand_name),
          ensureSupplier(supabase, master, item.supplier_name),
        ]);
        for (const unit of [item.unit, item.buy_unit, ...item.units.map((row) => row.unit)]) {
          await ensureUnit(supabase, master, unit);
        }
        const payload = buatPayloadItemAccurate(item, {
          category_id: categoryId,
          brand_id: brandId,
          supplier_id: supplierId,
        });
        const existing = existingByCode.get(item.code.toLowerCase());
        const saved = existing
          ? await supabase.from("items").update(payload).eq("id", existing.id).select("id").single()
          : await supabase.from("items").insert(payload).select("id").single();
        if (saved.error) throw new Error(pesanSimpanGagal(saved.error.message));
        const itemId = String(saved.data.id);
        const deleted = await supabase.from("item_units").delete().eq("item_id", itemId);
        if (deleted.error) throw new Error(pesanSimpanGagal(deleted.error.message));
        if (item.item_type !== "Jasa" && item.units.length) {
          const inserted = await supabase.from("item_units").insert(item.units.map((unit) => ({
            item_id: itemId,
            unit: unit.unit,
            factor: unit.factor,
            sell_price: unit.sell_price,
            buy_price: unit.buy_price,
          })));
          if (inserted.error) throw new Error(pesanSimpanGagal(inserted.error.message));
        }
        resultRows.push({
          row_no: item.row_no,
          code: item.code,
          name: item.name,
          status,
          changed_fields: initialPreview.find((row) => row.row_no === item.row_no)?.changed_fields ?? [],
          reason: null,
        });
      } catch (error) {
        resultRows.push({
          row_no: item.row_no,
          code: item.code,
          name: item.name,
          status: "Ditolak",
          changed_fields: [],
          reason: error instanceof Error ? error.message : "Gagal menyimpan baris",
        });
      }
    }

    const rows = resultRows.sort((a, b) => a.row_no - b.row_no);
    const postedRows = await supabase.from("import_run_rows").update({ status: "posted" })
      .eq("run_id", runId).eq("status", "valid");
    if (postedRows.error) throw new Error(postedRows.error.message);
    const postedRun = await supabase.from("import_runs").update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", runId).eq("status", "previewed");
    if (postedRun.error) throw new Error(postedRun.error.message);
    revalidatePath("/pos/sku");
    revalidatePath(BACK);
    const summary = summarize(rows);
    return {
      ok: summary.Ditolak === parsed.rejected.length,
      phase: "done",
      message: `${summary.Baru} baru, ${summary.Update} diperbarui, ${summary.Sama} tanpa perubahan. ${parsedCategories.rows.filter((row) => row.parent_name).length} relasi subkategori diterapkan. Stok tidak diubah.`,
      hierarchy_count: parsedCategories.rows.filter((row) => row.parent_name).length,
      rows,
      summary,
      new_masters: { categories: [], brands: [], units: [], suppliers: [] },
      run_id: runId,
      source_hash: sourceHash,
      source_fingerprint: fingerprintInput(sourceParts.map((part) => ({ name: part.name, size: part.data.byteLength }))),
    };
  } catch (error) {
    return stateError(error instanceof Error ? error.message : "Impor gagal diproses.");
  }
}

function getGroupUpload(formData: FormData): File {
  const file = formData.get("group_file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Pilih file Rincian Grup .xlsx terlebih dulu.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("File Rincian Grup harus berformat .xlsx.");
  if (file.size > MAX_XLSX_BYTES) throw new Error("Ukuran file Rincian Grup maksimal 15 MB.");
  return file;
}

async function prepareGroupImport(formData: FormData) {
  const supabase = await assertBolehKelola();
  const file = getGroupUpload(formData);
  const parsed = await bacaWorkbookKomponenGrup(new Uint8Array(await file.arrayBuffer()));
  if (parsed.errors.length) return { supabase, file, parsed, resolved: null };
  const master = await muatMasterGrup(supabase);
  const resolved = parseKomponenGrupRows(parsed.rows, master);
  return { supabase, file, parsed, resolved };
}

export async function previewKomponenGrup(formData: FormData): Promise<GroupImportState> {
  try {
    const prepared = await prepareGroupImport(formData);
    if (!prepared.resolved) return groupStateError(prepared.parsed.errors.join(" "));
    const { valid, rejected, incompleteGroups } = prepared.resolved;
    const unknown = rejected.filter((row) => /tidak ditemukan/.test(row.reason)).length;
    return {
      ok: rejected.length === 0 && valid.length > 0,
      phase: "preview",
      message: `${new Set(valid.map((row) => row.groupCode.toUpperCase())).size} Grup siap diproses. Pastikan semua rincian berasal dari export Accurate.`,
      complete: new Set(valid.map((row) => row.groupCode.toUpperCase())).size,
      incomplete: incompleteGroups.length,
      rejected: rejected.length + prepared.parsed.errors.length,
      unknown,
      errors: rejected.map((row) => `Baris ${row.row}: ${row.reason}`),
    };
  } catch (error) {
    return groupStateError(error instanceof Error ? error.message : "Rincian Grup gagal dibaca.");
  }
}

export async function konfirmasiKomponenGrup(formData: FormData): Promise<GroupImportState> {
  try {
    const prepared = await prepareGroupImport(formData);
    if (!prepared.resolved) return groupStateError(prepared.parsed.errors.join(" "));
    const { valid, rejected, incompleteGroups } = prepared.resolved;
    if (rejected.length || !valid.length) {
      return {
        ok: false,
        phase: "preview",
        message: "Impor diblokir sampai semua baris rincian valid.",
        complete: 0,
        incomplete: incompleteGroups.length,
        rejected: rejected.length,
        unknown: rejected.filter((row) => /tidak ditemukan/.test(row.reason)).length,
        errors: rejected.map((row) => `Baris ${row.row}: ${row.reason}`),
      };
    }
    const master = await muatMasterGrup(prepared.supabase);
    const payloadByGroup = groupComponentPayload(valid);
    let complete = 0;
    for (const [groupCode, payload] of payloadByGroup) {
      const group = master.get(groupCode.trim().toUpperCase());
      if (!group?.id) continue;
      const components = valid
        .filter((row) => row.groupCode === groupCode)
        .map((row) => ({ ...payload.find((item) => item.component_item_id === row.componentId), factor: row.factor }));
      const rpc = await prepared.supabase.rpc("replace_item_group_components", {
        p_group_item_id: group.id,
        p_components: components,
      });
      if (rpc.error) throw new Error(rpc.error.message);
      const activated = await prepared.supabase.from("items").update({ is_active: true })
        .eq("id", group.id).eq("item_type", "Grup");
      if (activated.error) throw new Error(activated.error.message);
      complete += 1;
    }
    revalidatePath("/pos/sku");
    revalidatePath(BACK);
    return {
      ok: true,
      phase: "done",
      message: `${complete} Grup aktif setelah rincian komponen berhasil disimpan.`,
      complete,
      incomplete: 0,
      rejected: 0,
      unknown: 0,
      errors: [],
    };
  } catch (error) {
    return groupStateError(error instanceof Error ? error.message : "Rincian Grup gagal disimpan.");
  }
}

function getInitialStockFile(formData: FormData): File {
  const file = formData.get("initial_stock_file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Pilih file Saldo Awal .xlsx terlebih dulu.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("File Saldo Awal harus berformat .xlsx.");
  if (file.size > MAX_XLSX_BYTES) throw new Error("Ukuran file Saldo Awal maksimal 15 MB.");
  return file;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function muatMasterSaldoAwal(supabase: any): Promise<ReadonlyMap<string, SaldoAwalMasterItem>> {
  const rows = await loadAll(supabase, "items", "id,code,unit,track_expiry,item_units(unit,factor)");
  return new Map(rows.map((row) => {
    const item: SaldoAwalMasterItem = {
      id: String(row.id),
      code: String(row.code ?? ""),
      unit: String(row.unit ?? ""),
      trackExpiry: Boolean(row.track_expiry),
      units: (row.item_units ?? []).map((unit: Record<string, unknown>) => ({
        unit: String(unit.unit ?? ""),
        factor: Number(unit.factor ?? 0),
      })),
    };
    return [item.code.trim().toLowerCase(), item] as const;
  }).filter(([code]) => Boolean(code)));
}

function initialStockRowsState(rows: ResolvedSaldoAwal[], names: ReadonlyMap<string, string>): InitialStockRow[] {
  return rows.map((row) => ({ ...row, itemName: names.get(row.itemId) ?? null }));
}

function initialStockSummary(rows: ResolvedSaldoAwal[]) {
  const valid = rows.filter((row) => row.status === "valid");
  return {
    valid: valid.length,
    rejected: rows.length - valid.length,
    source_qty: valid.reduce((total, row) => total + row.baseQty, 0),
    source_value: valid.reduce((total, row) => total + row.value, 0),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadInitialScope(supabase: any, branchId: string, warehouseId: string) {
  if (!branchId || !warehouseId) throw new Error("Cabang dan gudang wajib dipilih.");
  const [{ data: branch, error: branchError }, { data: warehouse, error: warehouseError }] = await Promise.all([
    supabase.from("branches").select("id, name, is_active").eq("id", branchId).maybeSingle(),
    supabase.from("warehouses").select("id, name, branch_id, is_active").eq("id", warehouseId).maybeSingle(),
  ]);
  if (branchError) throw new Error(branchError.message);
  if (warehouseError) throw new Error(warehouseError.message);
  if (!branch?.is_active || !warehouse?.is_active || warehouse.branch_id !== branchId) {
    throw new Error("Cabang atau gudang tidak tersedia untuk batch ini.");
  }
  return { branch, warehouse };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createInitialStockRun(supabase: any, input: {
  sourceName: string;
  sourceHash: string;
  branchId: string;
  warehouseId: string;
  asOf: string;
  summary: Record<string, number>;
  rows: ResolvedSaldoAwal[];
}) {
  const existing = await supabase.from("import_runs")
    .select("id,status,kind,branch_id,warehouse_id,as_of_date")
    .eq("kind", "initial_stock")
    .eq("source_hash", input.sourceHash)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    if (existing.data.status !== "previewed") throw new Error("Batch saldo awal yang sama sudah pernah diposting.");
    return String(existing.data.id);
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sesi login kedaluwarsa.");
  const inserted = await supabase.from("import_runs").insert({
    kind: "initial_stock",
    source_name: input.sourceName,
    source_hash: input.sourceHash,
    branch_id: input.branchId,
    warehouse_id: input.warehouseId,
    as_of_date: input.asOf,
    summary: input.summary,
    created_by: user.id,
  }).select("id").single();
  if (inserted.error) throw new Error(inserted.error.message);
  const rowPayload = input.rows.map((row) => ({
    run_id: inserted.data.id,
    source_row: row.row,
    source_code: row.itemCode,
    status: row.status,
    reason: row.reason,
    payload: {
      item_id: row.itemId,
      item_code: row.itemCode,
      warehouse_id: row.warehouseId,
      base_qty: row.baseQty,
      base_unit_cost: row.baseUnitCost,
      as_of: input.asOf,
      batch_no: row.batchNo,
      exp_date: row.expDate,
    },
  }));
  if (rowPayload.length) {
    const insertedRows = await supabase.from("import_run_rows").insert(rowPayload);
    if (insertedRows.error) throw new Error(insertedRows.error.message);
  }
  return String(inserted.data.id);
}

export async function previewSaldoAwalAccurate(formData: FormData): Promise<InitialStockState> {
  try {
    const supabase = await assertBolehKelola();
    const branchId = String(formData.get("branch_id") ?? "").trim();
    const warehouseId = String(formData.get("warehouse_id") ?? "").trim();
    const asOf = String(formData.get("as_of") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("Tanggal saldo wajib diisi.");
    await loadInitialScope(supabase, branchId, warehouseId);
    const file = getInitialStockFile(formData);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = await bacaWorkbookSaldoAwal(bytes);
    if (parsed.errors.length) return initialStockStateError(parsed.errors.join(" "));
    const master = await muatMasterSaldoAwal(supabase);
    const resolved = resolveSaldoAwalRows(parsed.rows, master, warehouseId);
    const sourceHash = await hashFiles([{ name: file.name, data: bytes }]);
    const summary = initialStockSummary(resolved);
    const runId = await createInitialStockRun(supabase, {
      sourceName: file.name,
      sourceHash,
      branchId,
      warehouseId,
      asOf,
      summary,
      rows: resolved,
    });
    const names = new Map([...master.values()].map((item) => [item.id, item.code]));
    return {
      ok: summary.valid > 0 && summary.rejected === 0,
      phase: "preview",
      message: summary.rejected
        ? `${summary.valid} baris siap, ${summary.rejected} baris ditolak. Perbaiki file sebelum posting.`
        : `${summary.valid} baris siap diposting ke gudang terpilih.`,
      branch_id: branchId,
      warehouse_id: warehouseId,
      as_of: asOf,
      run_id: runId,
      source_hash: sourceHash,
      rows: initialStockRowsState(resolved, names),
      source_qty: summary.source_qty,
      source_value: summary.source_value,
      checks: [],
    };
  } catch (error) {
    return initialStockStateError(error instanceof Error ? error.message : "Saldo awal gagal dibaca.");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function reconcilePostedInitialStock(supabase: any, runId: string, sourceQty: number, sourceValue: number, warehouseId: string, itemIds: string[]) {
  const [{ data: stock }, { data: layers }, { data: moves }] = await Promise.all([
    supabase.from("stock").select("qty").eq("warehouse_id", warehouseId).in("item_id", itemIds),
    supabase.from("stock_layers").select("qty_left, unit_cost").eq("warehouse_id", warehouseId)
      .eq("source", "saldo-awal-accurate").eq("source_ref", runId).in("item_id", itemIds),
    supabase.from("stock_moves").select("qty").eq("warehouse_id", warehouseId)
      .eq("source", "saldo-awal-accurate").eq("source_ref", runId).in("item_id", itemIds),
  ]);
  const stockQty = (stock ?? []).reduce((total: number, row: { qty: number }) => total + Number(row.qty), 0);
  const layerQty = (layers ?? []).reduce((total: number, row: { qty_left: number }) => total + Number(row.qty_left), 0);
  const moveQty = (moves ?? []).reduce((total: number, row: { qty: number }) => total + Number(row.qty), 0);
  const layerValue = (layers ?? []).reduce((total: number, row: { qty_left: number; unit_cost: number }) => total + Number(row.qty_left) * Number(row.unit_cost), 0);
  const result = reconcileInitialStock({ sourceQty, stockQty, layerQty, moveQty, sourceValue, layerValue });
  return [
    { label: "Qty stok" as const, ok: Math.abs(result.differences.stock) < 0.000001, difference: result.differences.stock },
    { label: "Qty layer" as const, ok: Math.abs(result.differences.layers) < 0.000001, difference: result.differences.layers },
    { label: "Qty kartu" as const, ok: Math.abs(result.differences.moves) < 0.000001, difference: result.differences.moves },
    { label: "Nilai layer" as const, ok: Math.abs(result.differences.value) < 0.000001, difference: result.differences.value },
  ];
}

export async function postSaldoAwalAccurate(formData: FormData): Promise<InitialStockState> {
  try {
    const supabase = await assertBolehKelola();
    if (String(formData.get("confirm_scope") ?? "") !== "on") {
      return initialStockStateError("Centang konfirmasi gudang dan tanggal sebelum posting.");
    }
    const runId = String(formData.get("run_id") ?? "").trim();
    const branchId = String(formData.get("branch_id") ?? "").trim();
    const warehouseId = String(formData.get("warehouse_id") ?? "").trim();
    const asOf = String(formData.get("as_of") ?? "").trim();
    if (!runId || !branchId || !warehouseId || !asOf) return initialStockStateError("Batch saldo awal tidak lengkap.");
    await loadInitialScope(supabase, branchId, warehouseId);
    const file = getInitialStockFile(formData);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sourceHash = await hashFiles([{ name: file.name, data: bytes }]);
    const run = await supabase.from("import_runs")
      .select("id,kind,status,source_hash,branch_id,warehouse_id,as_of_date,summary")
      .eq("id", runId).maybeSingle();
    if (run.error) throw new Error(run.error.message);
    if (!run.data || run.data.kind !== "initial_stock" || run.data.status !== "previewed"
      || run.data.source_hash !== sourceHash || run.data.branch_id !== branchId
      || run.data.warehouse_id !== warehouseId || run.data.as_of_date !== asOf) {
      return initialStockStateError("File atau pilihan batch berubah. Jalankan preview lagi.");
    }
    const rpc = await supabase.rpc("post_accurate_initial_stock", { p_run_id: runId });
    if (rpc.error) throw new Error(rpc.error.message);
    const posted = await supabase.from("import_run_rows").select("payload").eq("run_id", runId).eq("status", "posted");
    if (posted.error) throw new Error(posted.error.message);
    const payloads = (posted.data ?? []).map((row: { payload: Record<string, unknown> }) => row.payload);
    const itemIds = [...new Set(payloads.map((row) => String(row.item_id)).filter(Boolean))];
    const sourceQty = payloads.reduce((total, row) => total + Number(row.base_qty ?? 0), 0);
    const sourceValue = payloads.reduce((total, row) => total + Number(row.base_qty ?? 0) * Number(row.base_unit_cost ?? 0), 0);
    const checks = await reconcilePostedInitialStock(supabase, runId, sourceQty, sourceValue, warehouseId, itemIds);
    revalidatePath("/pos/stok");
    revalidatePath(BACK);
    const ok = checks.every((check) => check.ok);
    return {
      ok,
      phase: "done",
      message: ok ? "Saldo awal diposting dan empat rekonsiliasi cocok." : "Posting selesai, tetapi rekonsiliasi belum cocok. Status tetap perlu ditinjau.",
      branch_id: branchId,
      warehouse_id: warehouseId,
      as_of: asOf,
      run_id: runId,
      source_hash: sourceHash,
      rows: [],
      source_qty: sourceQty,
      source_value: sourceValue,
      checks,
    };
  } catch (error) {
    return initialStockStateError(error instanceof Error ? error.message : "Saldo awal gagal diposting.");
  }
}
