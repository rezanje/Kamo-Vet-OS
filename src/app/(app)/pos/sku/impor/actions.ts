"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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
  type AccurateItem,
  type AccuratePreviewRow,
  type AccuratePreviewStatus,
  type ExistingAccurateCategory,
  type ExistingAccurateItem,
} from "@/lib/impor-accurate";

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
  };
}

function summarize(rows: AccuratePreviewRow[]) {
  const summary = emptySummary();
  rows.forEach((row) => { summary[row.status] += 1; });
  return summary;
}

function getUpload(formData: FormData): File {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Pilih file Accurate .xlsx terlebih dulu.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("File harus berformat .xlsx.");
  if (file.size > MAX_XLSX_BYTES) throw new Error("Ukuran file maksimal 15 MB.");
  return file;
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
    const file = getUpload(formData);
    const categoryFile = getCategoryUpload(formData);
    const parsed = await bacaWorkbookAccurate(new Uint8Array(await file.arrayBuffer()));
    if (parsed.errors.length) return stateError(parsed.errors.join(" "));
    const parsedCategories = categoryFile
      ? await bacaWorkbookKategoriAccurate(new Uint8Array(await categoryFile.arrayBuffer()))
      : { rows: [], errors: [] };
    if (parsedCategories.errors.length) return stateError(parsedCategories.errors.join(" "));
    const master = await muatMasterAccurate(supabase);
    const rows = buatPreviewAccurate(parsed, master.items);
    const hierarchyCount = parsedCategories.rows.filter((row) => row.parent_name).length;
    return {
      ok: true,
      phase: "preview",
      message: `${parsed.rows.length} baris valid diperiksa. ${hierarchyCount} relasi subkategori ditemukan. Stok tidak diimpor.`,
      hierarchy_count: hierarchyCount,
      rows,
      summary: summarize(rows),
      new_masters: newMasters(parsed.rows, master, parsedCategories.rows),
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
    const file = getUpload(formData);
    const categoryFile = getCategoryUpload(formData);
    const parsed = await bacaWorkbookAccurate(new Uint8Array(await file.arrayBuffer()));
    if (parsed.errors.length) return stateError(parsed.errors.join(" "));
    const parsedCategories = categoryFile
      ? await bacaWorkbookKategoriAccurate(new Uint8Array(await categoryFile.arrayBuffer()))
      : { rows: [], errors: [] };
    if (parsedCategories.errors.length) return stateError(parsedCategories.errors.join(" "));
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
    };
  } catch (error) {
    return stateError(error instanceof Error ? error.message : "Impor gagal diproses.");
  }
}
