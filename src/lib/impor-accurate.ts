import ExcelJS from "exceljs";
import type { ItemType } from "./barang";

export type AccurateUnit = {
  unit: string;
  factor: number;
  sell_price: number;
  buy_price: number;
};

export type AccurateItem = {
  row_no: number;
  code: string;
  name: string;
  item_type: Exclude<ItemType, "Grup">;
  category_name: string;
  brand_name: string | null;
  unit: string;
  sell_price: number;
  buy_price: number;
  min_stock: number;
  supplier_name: string | null;
  buy_unit: string | null;
  min_buy: number;
  upc: string | null;
  track_expiry: boolean;
  default_discount: number;
  is_active: boolean;
  units: AccurateUnit[];
};

export type AccurateIssue = {
  row_no: number;
  code: string;
  name: string;
  reason: string;
};

export type AccurateWorkbookResult = {
  rows: AccurateItem[];
  skipped: AccurateIssue[];
  rejected: AccurateIssue[];
  errors: string[];
};

export type AccurateCategory = {
  row_no: number;
  name: string;
  parent_name: string | null;
};

export type AccurateCategoryWorkbookResult = {
  rows: AccurateCategory[];
  errors: string[];
};

export type ExistingAccurateCategory = {
  id: string;
  name: string;
  parent_id: string | null;
};

export type ExistingAccurateItem = Omit<AccurateItem, "row_no"> & { id: string };

export type AccuratePreviewStatus = "Baru" | "Update" | "Sama" | "Dilewati" | "Ditolak";

export type AccuratePreviewRow = {
  row_no: number;
  code: string;
  name: string;
  status: AccuratePreviewStatus;
  changed_fields: string[];
  reason: string | null;
};

export type AccurateItemRefs = {
  category_id: string;
  brand_id: string | null;
  supplier_id: string | null;
};

const REQUIRED_HEADERS = [
  "Kode Barang",
  "Nama Barang",
  "Jenis Barang",
  "Kategori Barang",
  "Satuan",
] as const;

const normalizedHeader = (value: unknown) => text(value).replace(/\s+/g, " ").toLowerCase();

function cellValue(value: ExcelJS.CellValue | undefined): unknown {
  if (value == null) return "";
  if (value instanceof Date) return value;
  if (typeof value !== "object") return value;
  if ("result" in value) return value.result ?? "";
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("text" in value) return value.text;
  return String(value);
}

function text(value: unknown): string {
  const raw = cellValue(value as ExcelJS.CellValue | undefined);
  return String(raw ?? "").trim();
}

function optionalNumber(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Number(raw.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

const yes = (value: unknown) => text(value).toUpperCase() === "YA";

type ColumnMap = Map<string, number>;

function rowIssue(rowNo: number, get: (header: string) => unknown, reason: string): AccurateIssue {
  return {
    row_no: rowNo,
    code: text(get("Kode Barang")) || "—",
    name: text(get("Nama Barang")) || "—",
    reason,
  };
}

function mapItemType(raw: string): AccurateItem["item_type"] | null {
  if (raw === "INV") return "Persediaan";
  if (raw === "SVC") return "Jasa";
  if (raw === "NON") return "Non-Persediaan";
  return null;
}

function parseDataRow(
  worksheet: ExcelJS.Worksheet,
  columns: ColumnMap,
  rowNo: number,
): { item?: AccurateItem; skipped?: AccurateIssue; rejected?: AccurateIssue } {
  const row = worksheet.getRow(rowNo);
  const get = (header: string) => {
    const index = columns.get(normalizedHeader(header));
    return index ? row.getCell(index).value : "";
  };
  const code = text(get("Kode Barang"));
  const name = text(get("Nama Barang"));
  const typeRaw = text(get("Jenis Barang")).toUpperCase();
  const category = text(get("Kategori Barang"));
  const baseUnit = text(get("Satuan"));

  if (![code, name, typeRaw, category, baseUnit].some(Boolean)) return {};
  if (typeRaw.startsWith("GROUP")) {
    return { skipped: rowIssue(rowNo, get, "Grup dilewati karena export tidak membawa rincian komponen") };
  }
  if (typeRaw.startsWith("VARIANT")) {
    return { skipped: rowIssue(rowNo, get, "Varian dilewati; fase ini memakai SKU terpisah") };
  }
  if (!code) return { rejected: rowIssue(rowNo, get, "Kode barang wajib diisi") };
  if (!name) return { rejected: rowIssue(rowNo, get, "Nama barang wajib diisi") };
  const itemType = mapItemType(typeRaw);
  if (!itemType) return { rejected: rowIssue(rowNo, get, `Jenis barang "${typeRaw || "(kosong)"}" tidak didukung`) };
  if (!category) return { rejected: rowIssue(rowNo, get, "Kategori barang wajib diisi") };
  if (!baseUnit) return { rejected: rowIssue(rowNo, get, "Satuan dasar wajib diisi") };

  const sellPrice = optionalNumber(get("Def. Hrg. Jual Satuan #1")) ?? 0;
  const buyPrice = optionalNumber(get("Harga Beli")) ?? 0;
  if (!Number.isFinite(sellPrice) || sellPrice < 0) {
    return { rejected: rowIssue(rowNo, get, "Harga jual tidak boleh negatif atau bukan angka") };
  }
  if (!Number.isFinite(buyPrice) || buyPrice < 0) {
    return { rejected: rowIssue(rowNo, get, "Harga beli tidak boleh negatif") };
  }

  const minStockRaw = optionalNumber(get("Batas Minimum Stok")) ?? 0;
  const minBuyRaw = optionalNumber(get("Minimum Beli")) ?? 0;
  const discountRaw = optionalNumber(get("Default Diskon (%)")) ?? 0;
  if (![minStockRaw, minBuyRaw, discountRaw].every(Number.isFinite)) {
    return { rejected: rowIssue(rowNo, get, "Stok minimum, minimum beli, atau diskon bukan angka") };
  }

  const units: AccurateUnit[] = [];
  const seenUnits = new Set([baseUnit.toLowerCase()]);
  for (let position = 2; position <= 5; position += 1) {
    const unit = text(get(`Satuan #${position}`));
    const factorRaw = optionalNumber(get(`Rasio Satuan #${position}`));
    const unitSellPrice = optionalNumber(get(`Def. Hrg. Jual Satuan #${position}`)) ?? 0;
    // Accurate kadang menggandakan harga ke kolom lanjutan tanpa satuan/rasio.
    // Pasangan satuan kosong bukan unit tambahan, jadi aman diabaikan.
    if (!unit && factorRaw == null) continue;
    if (!unit) return { rejected: rowIssue(rowNo, get, `Satuan #${position} kosong`) };
    if (factorRaw == null || !Number.isFinite(factorRaw) || factorRaw <= 0) {
      return { rejected: rowIssue(rowNo, get, `Rasio Satuan #${position} harus lebih dari 0`) };
    }
    if (!Number.isFinite(unitSellPrice) || unitSellPrice < 0) {
      return { rejected: rowIssue(rowNo, get, `Harga jual Satuan #${position} tidak valid`) };
    }
    const key = unit.toLowerCase();
    if (seenUnits.has(key)) {
      return { rejected: rowIssue(rowNo, get, `Satuan "${unit}" kembar pada barang yang sama`) };
    }
    seenUnits.add(key);
    units.push({ unit, factor: factorRaw, sell_price: unitSellPrice, buy_price: 0 });
  }

  return {
    item: {
      row_no: rowNo,
      code,
      name,
      item_type: itemType,
      category_name: category,
      brand_name: text(get("Merek Barang")) || null,
      unit: baseUnit,
      sell_price: sellPrice,
      buy_price: buyPrice,
      min_stock: itemType === "Persediaan" ? Math.max(0, minStockRaw) : 0,
      supplier_name: text(get("Pemasok Utama")) || null,
      buy_unit: text(get("Satuan Beli")) || null,
      min_buy: Math.max(0, minBuyRaw),
      upc: text(get("UPC/Barcode")) || null,
      track_expiry: yes(get("Pakai tanggal kadaluarsa")),
      default_discount: Math.min(100, Math.max(0, discountRaw)),
      is_active: !yes(get("Non Aktif")),
      units,
    },
  };
}

export async function bacaWorkbookAccurate(bytes: Uint8Array): Promise<AccurateWorkbookResult> {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS 4 membawa deklarasi Buffer lama yang bentrok dengan @types/node 20;
  // runtime menerima Uint8Array/Buffer ini dengan benar.
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  const worksheet = workbook.getWorksheet("Barang & Jasa");
  if (!worksheet) {
    return { rows: [], skipped: [], rejected: [], errors: ["Sheet Barang & Jasa tidak ditemukan"] };
  }

  const columns: ColumnMap = new Map();
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
    const header = normalizedHeader(cell.value);
    if (header) columns.set(header, column);
  });
  const missing = REQUIRED_HEADERS.filter((header) => !columns.has(normalizedHeader(header)));
  if (missing.length > 0) {
    return {
      rows: [], skipped: [], rejected: [],
      errors: [`Kolom wajib tidak ditemukan: ${missing.join(", ")}`],
    };
  }

  const rows: AccurateItem[] = [];
  const skipped: AccurateIssue[] = [];
  const rejected: AccurateIssue[] = [];
  for (let rowNo = 2; rowNo <= worksheet.rowCount; rowNo += 1) {
    const parsed = parseDataRow(worksheet, columns, rowNo);
    if (parsed.item) rows.push(parsed.item);
    if (parsed.skipped) skipped.push(parsed.skipped);
    if (parsed.rejected) rejected.push(parsed.rejected);
  }

  const codeCounts = new Map<string, number>();
  for (const row of rows) {
    const key = row.code.toLowerCase();
    codeCounts.set(key, (codeCounts.get(key) ?? 0) + 1);
  }
  const duplicateKeys = new Set([...codeCounts].filter(([, count]) => count > 1).map(([key]) => key));
  const uniqueRows: AccurateItem[] = [];
  for (const row of rows) {
    if (!duplicateKeys.has(row.code.toLowerCase())) {
      uniqueRows.push(row);
      continue;
    }
    rejected.push({
      row_no: row.row_no,
      code: row.code,
      name: row.name,
      reason: "Kode kembar di dalam file ini",
    });
  }

  rejected.sort((a, b) => a.row_no - b.row_no);
  return { rows: uniqueRows, skipped, rejected, errors: [] };
}

export async function bacaWorkbookKategoriAccurate(
  bytes: Uint8Array,
): Promise<AccurateCategoryWorkbookResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  const worksheet = workbook.getWorksheet("Kategori Barang");
  if (!worksheet) return { rows: [], errors: ["Sheet Kategori Barang tidak ditemukan"] };

  const columns: ColumnMap = new Map();
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
    const header = normalizedHeader(cell.value);
    if (header) columns.set(header, column);
  });
  const nameColumn = columns.get(normalizedHeader("Nama"));
  const parentColumn = columns.get(normalizedHeader("Sub Kategori"));
  if (!nameColumn || !parentColumn) {
    return { rows: [], errors: ["Kolom wajib tidak ditemukan: Nama, Sub Kategori"] };
  }

  const rows: AccurateCategory[] = [];
  const errors: string[] = [];
  const rowByName = new Map<string, AccurateCategory>();
  for (let rowNo = 2; rowNo <= worksheet.rowCount; rowNo += 1) {
    const row = worksheet.getRow(rowNo);
    const name = text(row.getCell(nameColumn).value);
    const parentName = text(row.getCell(parentColumn).value) || null;
    if (!name && !parentName) continue;
    if (!name) {
      errors.push(`Nama kategori kosong pada baris ${rowNo}`);
      continue;
    }
    const key = name.toLowerCase();
    if (rowByName.has(key)) {
      errors.push(`Kategori "${name}" kembar pada baris ${rowNo}`);
      continue;
    }
    const category = { row_no: rowNo, name, parent_name: parentName };
    rows.push(category);
    rowByName.set(key, category);
  }

  for (const row of rows) {
    if (!row.parent_name) continue;
    const parentKey = row.parent_name.toLowerCase();
    if (parentKey === row.name.toLowerCase()) {
      errors.push(`Hierarchy kategori melingkar pada "${row.name}"`);
    } else if (!rowByName.has(parentKey)) {
      errors.push(`Induk kategori "${row.parent_name}" tidak ditemukan untuk "${row.name}"`);
    }
  }
  if (errors.length) return { rows, errors };

  const parentByName = new Map(rows.map((row) => [
    row.name.toLowerCase(),
    row.parent_name?.toLowerCase() ?? null,
  ]));
  for (const row of rows) {
    const seen = new Set<string>();
    let current: string | null = row.name.toLowerCase();
    while (current) {
      if (seen.has(current)) {
        errors.push(`Hierarchy kategori melingkar pada "${row.name}"`);
        break;
      }
      seen.add(current);
      current = parentByName.get(current) ?? null;
    }
    if (errors.length) break;
  }
  return { rows, errors };
}

export function rencanaIndukKategoriAccurate(
  rows: AccurateCategory[],
  existingCategories: ExistingAccurateCategory[],
) {
  const existingByName = new Map(
    existingCategories.map((row) => [row.name.trim().toLowerCase(), row]),
  );
  return rows.flatMap((row) => {
    const category = existingByName.get(row.name.toLowerCase());
    if (!category) throw new Error(`Kategori "${row.name}" belum dibuat`);
    const parent = row.parent_name
      ? existingByName.get(row.parent_name.toLowerCase())
      : null;
    if (row.parent_name && !parent) throw new Error(`Induk kategori "${row.parent_name}" belum dibuat`);
    const parentId = parent?.id ?? null;
    return category.parent_id === parentId ? [] : [{ id: category.id, parent_id: parentId }];
  });
}

const COMPARABLE_FIELDS = [
  "name", "item_type", "category_name", "brand_name", "unit", "sell_price",
  "buy_price", "min_stock", "supplier_name", "buy_unit", "min_buy", "upc",
  "track_expiry", "default_discount", "is_active", "units",
] as const;

function normalizedComparable(field: (typeof COMPARABLE_FIELDS)[number], value: unknown): unknown {
  if (field === "units") {
    return ((value ?? []) as AccurateUnit[])
      .map((unit) => ({
        unit: unit.unit.trim().toLowerCase(),
        factor: Number(unit.factor),
        sell_price: Number(unit.sell_price),
        buy_price: Number(unit.buy_price),
      }))
      .sort((a, b) => a.unit.localeCompare(b.unit));
  }
  if (["sell_price", "buy_price", "min_stock", "min_buy", "default_discount"].includes(field)) {
    return Number(value ?? 0);
  }
  if (["track_expiry", "is_active"].includes(field)) return Boolean(value);
  return String(value ?? "").trim().toLowerCase();
}

function changedFields(item: AccurateItem, existing: ExistingAccurateItem): string[] {
  return COMPARABLE_FIELDS.filter((field) => (
    JSON.stringify(normalizedComparable(field, item[field]))
      !== JSON.stringify(normalizedComparable(field, existing[field]))
  ));
}

/** Preview deterministik. Tidak membaca/menulis DB dan tidak membawa data stok. */
export function buatPreviewAccurate(
  workbook: AccurateWorkbookResult,
  existingItems: ExistingAccurateItem[],
): AccuratePreviewRow[] {
  const existingByCode = new Map(existingItems.map((item) => [item.code.trim().toLowerCase(), item]));
  const preview: AccuratePreviewRow[] = workbook.rows.map((item) => {
    const existing = existingByCode.get(item.code.toLowerCase());
    const changed = existing ? changedFields(item, existing) : [];
    return {
      row_no: item.row_no,
      code: item.code,
      name: item.name,
      status: existing ? (changed.length ? "Update" : "Sama") : "Baru",
      changed_fields: changed,
      reason: null,
    };
  });
  preview.push(...workbook.skipped.map((issue) => ({
    row_no: issue.row_no,
    code: issue.code,
    name: issue.name,
    status: "Dilewati" as const,
    changed_fields: [],
    reason: issue.reason,
  })));
  preview.push(...workbook.rejected.map((issue) => ({
    row_no: issue.row_no,
    code: issue.code,
    name: issue.name,
    status: "Ditolak" as const,
    changed_fields: [],
    reason: issue.reason,
  })));
  return preview.sort((a, b) => a.row_no - b.row_no);
}

/** Payload hanya master barang. Sengaja tak punya qty/gudang/layer stok. */
export function buatPayloadItemAccurate(item: AccurateItem, refs: AccurateItemRefs) {
  const punyaStok = item.item_type === "Persediaan";
  const isJasa = item.item_type === "Jasa";
  return {
    code: item.code,
    name: item.name,
    category_id: refs.category_id,
    item_type: item.item_type,
    brand_id: refs.brand_id,
    upc: item.upc,
    unit: item.unit,
    sell_price: item.sell_price,
    buy_price: item.buy_price,
    min_stock: punyaStok ? item.min_stock : 0,
    tindakan_kategori: isJasa ? "Konsultasi" : null,
    supplier_id: punyaStok ? refs.supplier_id : null,
    buy_unit: punyaStok ? (item.buy_unit || item.unit) : null,
    min_buy: punyaStok ? item.min_buy : 0,
    min_sell_qty: 0,
    default_discount: item.default_discount,
    substitute_item_id: null,
    track_expiry: punyaStok && item.track_expiry,
    is_active: item.is_active,
  };
}
