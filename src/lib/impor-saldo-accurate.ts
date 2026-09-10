import ExcelJS from "exceljs";

export type ReconcileInput = {
  sourceQty: number;
  stockQty: number;
  layerQty: number;
  moveQty: number;
  sourceValue: number;
  layerValue: number;
};

export type StockKeyRow = {
  row: number;
  warehouseId: string;
  itemId: string;
  batchNo?: string | null;
  expDate?: string | null;
};

export type StockKeyIssue = StockKeyRow & { message: string };

export type SaldoAwalDraft = {
  row: number;
  itemCode: string;
  qty: number;
  unit: string;
  unitCost: number;
  batchNo: string | null;
  expDate: string | null;
  branchName: string | null;
  warehouseName: string | null;
  asOf: string | null;
};

export type SaldoAwalWorkbookResult = {
  rows: SaldoAwalDraft[];
  errors: string[];
};

export type SaldoAwalMasterItem = {
  id: string;
  code: string;
  unit: string;
  itemType: string;
  trackExpiry: boolean;
  units: { unit: string; factor: number }[];
};

type InitialStockScopeRow = Pick<SaldoAwalDraft, "branchName" | "warehouseName" | "asOf">;

export type InitialStockBranchOption = { id: string; code: string; name: string };
export type InitialStockWarehouseOption = { id: string; branch_id: string; code: string; name: string };
export type InitialStockScopeCandidate = {
  branch: InitialStockBranchOption;
  warehouse: InitialStockWarehouseOption;
};
export type InitialStockScopeClarification = {
  sourceBranch: string;
  sourceWarehouse: string;
  candidates: InitialStockScopeCandidate[];
};
export type InitialStockScopeSelection = {
  branchId: string;
  warehouseId: string;
};

export type InitialStockSourceScope =
  | { ok: true; branch: InitialStockBranchOption; warehouse: InitialStockWarehouseOption; asOf: string }
  | { ok: false; message: string; clarification?: InitialStockScopeClarification };

export type ResolvedSaldoAwal = SaldoAwalDraft & {
  itemId: string;
  baseQty: number;
  baseUnitCost: number;
  value: number;
  warehouseId: string;
  sourceRows?: number[];
  status: "valid" | "rejected" | "skipped";
  reason: string | null;
};

export function toBaseStock(input: { qty: number; factor: number; unitCost: number }) {
  const baseQty = input.qty * input.factor;
  const baseUnitCost = input.unitCost / input.factor;
  return { baseQty, baseUnitCost, value: baseQty * baseUnitCost };
}

export function reconcileInitialStock(value: ReconcileInput) {
  const differences = {
    stock: value.stockQty - value.sourceQty,
    layers: value.layerQty - value.sourceQty,
    moves: value.moveQty - value.sourceQty,
    value: value.layerValue - value.sourceValue,
  };
  return {
    ok: Object.values(differences).every((number) => Math.abs(number) < 0.000001),
    differences,
  };
}

export const stockKey = (row: StockKeyRow) => [
  row.warehouseId,
  row.itemId,
  row.batchNo ?? "",
  row.expDate ?? "",
].join("|");

export function duplicateStockKeys(rows: StockKeyRow[]): StockKeyIssue[] {
  const grouped = new Map<string, StockKeyRow[]>();
  for (const row of rows) {
    const key = stockKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped.values()]
    .filter((group) => group.length > 1)
    .flatMap((group) => group.map((row) => ({ ...row, message: "Baris saldo awal kembar" })))
    .sort((a, b) => a.row - b.row);
}

function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && "result" in value) return cellText(value.result as ExcelJS.CellValue);
  return String(value).trim();
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[\s_/-]+/g, "").replace(/[()]/g, "");
}

function scopeKey(value: string) {
  return value.trim().toLocaleLowerCase("id-ID").replace(/\s+/g, " ");
}

function scopeCandidateKey(value: string) {
  return scopeKey(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(wh|warehouse)\s+/, "");
}

function isExactScope(value: string, source: string) {
  return scopeKey(value) === scopeKey(source);
}

function isScopeCandidate(value: string, source: string) {
  return scopeCandidateKey(value) === scopeCandidateKey(source);
}

function oneSourceValue(rows: InitialStockScopeRow[], key: Exclude<keyof InitialStockScopeRow, "asOf">, label: string) {
  const values = [...new Set(rows.map((row) => row[key]).filter((value): value is string => Boolean(value)))];
  if (!values.length) return { ok: false as const, message: `File belum memuat ${label} saldo.` };
  if (values.length > 1) return { ok: false as const, message: `File memuat lebih dari satu ${label}. Pisahkan file per ${label}.` };
  if (rows.some((row) => !row[key])) return { ok: false as const, message: `Sebagian baris belum memuat ${label} saldo.` };
  return { ok: true as const, value: values[0] };
}

function selectedAsOf(rows: InitialStockScopeRow[], value: string | null | undefined) {
  const selected = value?.trim() ?? "";
  const selectedDate = new Date(`${selected}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selected) || Number.isNaN(selectedDate.getTime()) || selectedDate.toISOString().slice(0, 10) !== selected) {
    return { ok: false as const, message: "Pilih Tanggal posisi saldo awal terlebih dulu." };
  }
  const sourceDates = [...new Set(rows.map((row) => row.asOf).filter((date): date is string => Boolean(date)))];
  if (sourceDates.length > 1) {
    return { ok: false as const, message: "File memuat lebih dari satu tanggal saldo. Pisahkan file per tanggal." };
  }
  if (sourceDates[0] && sourceDates[0] !== selected) {
    return { ok: false as const, message: `Tanggal posisi saldo awal ${selected} berbeda dengan tanggal di file ${sourceDates[0]}.` };
  }
  return { ok: true as const, value: sourceDates[0] ?? selected };
}

export function resolveInitialStockSourceScope(
  rows: InitialStockScopeRow[],
  branches: InitialStockBranchOption[],
  warehouses: InitialStockWarehouseOption[],
  selectedAsOfValue?: string | null,
  selectedScope?: InitialStockScopeSelection | null,
): InitialStockSourceScope {
  const branchSource = oneSourceValue(rows, "branchName", "cabang");
  if (!branchSource.ok) return branchSource;
  const warehouseSource = oneSourceValue(rows, "warehouseName", "gudang");
  if (!warehouseSource.ok) return warehouseSource;
  const dateSource = selectedAsOf(rows, selectedAsOfValue);
  if (!dateSource.ok) return dateSource;

  const exactBranches = branches.filter((item) => [item.code, item.name].some((value) => isExactScope(value, branchSource.value)));
  const candidateBranches = exactBranches.length
    ? exactBranches
    : branches.filter((item) => [item.code, item.name].some((value) => isScopeCandidate(value, branchSource.value)));
  if (!candidateBranches.length) return { ok: false, message: `Cabang ${branchSource.value} dari file belum tersedia di VetOS.` };

  const exactCandidates = candidateBranches.flatMap((branch) => warehouses
    .filter((warehouse) => warehouse.branch_id === branch.id
      && [warehouse.code, warehouse.name].some((value) => isExactScope(value, warehouseSource.value)))
    .map((warehouse) => ({ branch, warehouse })));
  if (exactCandidates.length === 1) {
    return { ok: true, branch: exactCandidates[0].branch, warehouse: exactCandidates[0].warehouse, asOf: dateSource.value };
  }

  const candidates = candidateBranches.flatMap((branch) => warehouses
    .filter((warehouse) => warehouse.branch_id === branch.id
      && [warehouse.code, warehouse.name].some((value) => isScopeCandidate(value, warehouseSource.value)))
    .map((warehouse) => ({ branch, warehouse })));
  if (!candidates.length) {
    const branch = candidateBranches[0];
    return { ok: false, message: `Gudang ${warehouseSource.value} dari file belum tersedia pada cabang ${branch.name}.` };
  }

  const selected = candidates.find((candidate) => candidate.branch.id === selectedScope?.branchId
    && candidate.warehouse.id === selectedScope?.warehouseId);
  if (selected) return { ok: true, branch: selected.branch, warehouse: selected.warehouse, asOf: dateSource.value };

  return {
    ok: false,
    message: "Nama tujuan saldo di file perlu diklarifikasi sebelum impor dilanjutkan.",
    clarification: {
      sourceBranch: branchSource.value,
      sourceWarehouse: warehouseSource.value,
      candidates,
    },
  };
}

function findColumn(headers: Map<string, number>, aliases: string[]) {
  for (const alias of aliases) {
    const column = headers.get(normalizeHeader(alias));
    if (column) return column;
  }
  return null;
}

function excelDate(value: ExcelJS.CellValue | undefined): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = cellText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  const serial = Number(text);
  if (!Number.isFinite(serial) || serial < 1) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function numberValue(value: ExcelJS.CellValue | undefined) {
  // Nilai numerik dari Excel harus dipakai apa adanya. Menghapus titik pada
  // angka desimal (mis. 4.350,88 yang sudah dibaca Excel sebagai 4350.88)
  // mengubah HPP menjadi angka yang sangat besar.
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "result" in value) {
    return numberValue((value as { result?: ExcelJS.CellValue }).result);
  }
  const text = cellText(value).replace(/\./g, "").replace(/,/g, ".");
  return Number(text);
}

/**
 * ExcelJS mengembalikan rumus tanpa nilai tersimpan sebagai `{ formula }`.
 * Nilainya tidak boleh ditebak: terutama rumus yang merujuk workbook lain
 * akan menghasilkan stok/modal berbeda bila asalnya tidak ikut diunggah.
 */
function formulaTanpaNilai(value: ExcelJS.CellValue | undefined) {
  if (!value || typeof value !== "object" || !("formula" in value)) return false;
  const formula = value as { result?: unknown };
  return formula.result === undefined || formula.result === null || formula.result === "";
}

export async function bacaWorkbookSaldoAwal(bytes: Uint8Array): Promise<SaldoAwalWorkbookResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const worksheet = workbook.getWorksheet("Saldo Awal") ?? workbook.worksheets[0];
  if (!worksheet) return { rows: [], errors: ["Sheet Saldo Awal tidak ditemukan"] };

  const headers = new Map<string, number>();
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
    headers.set(normalizeHeader(cellText(cell.value)), column);
  });

  const isCombinedItemWorkbook = headers.has(normalizeHeader("Kuantitas Saldo Awal"));
  const columns = {
    code: findColumn(headers, ["Kode Barang", "Kode", "Item Code"]),
    qty: findColumn(headers, ["Kuantitas", "Qty", "Jumlah", "Kuantitas Saldo Awal"]),
    balanceUnit: isCombinedItemWorkbook ? findColumn(headers, ["Satuan Saldo Awal"]) : findColumn(headers, ["Satuan", "Unit"]),
    masterUnit: isCombinedItemWorkbook ? findColumn(headers, ["Satuan"]) : null,
    unitCost: findColumn(headers, ["HPP", "Harga Pokok", "Unit Cost", "Biaya Satuan", "Nilai Satuan"]),
    batchNo: findColumn(headers, ["Batch", "No Batch", "Batch No"]),
    expDate: findColumn(headers, ["Expiry", "Tanggal Kadaluarsa", "Exp Date", "Kadaluarsa"]),
    branchName: findColumn(headers, ["Cabang Saldo", "Cabang"]),
    warehouseName: findColumn(headers, ["Gudang Saldo Awal", "Gudang"]),
    asOf: findColumn(headers, ["Per Tanggal", "Tanggal Saldo"]),
  };
  const missing = [
    ["Kode Barang", columns.code],
    ["Kuantitas", columns.qty],
    ["HPP", columns.unitCost],
  ].filter(([, column]) => !column).map(([name]) => name);
  if (missing.length) return { rows: [], errors: [`Kolom wajib tidak ditemukan: ${missing.join(", ")}`] };

  const rows: SaldoAwalDraft[] = [];
  const errors: string[] = [];
  const rumusQtyTanpaNilai: number[] = [];
  const rumusHppTanpaNilai: number[] = [];
  for (let rowNo = 2; rowNo <= worksheet.rowCount; rowNo += 1) {
    const row = worksheet.getRow(rowNo);
    const itemCode = cellText(row.getCell(columns.code!).value);
    const rawQtyCell = row.getCell(columns.qty!).value;
    const qtyMasihRumus = formulaTanpaNilai(rawQtyCell);
    const rawQty = numberValue(rawQtyCell);
    // Pada file gabungan, saldo nol tidak pernah diposting. Lewati sebelum
    // menilai HPP/satuan/tanggal agar sisa pembulatan sumber tidak mengunci
    // seluruh impor master dan saldo yang benar-benar ada.
    if (isCombinedItemWorkbook && !qtyMasihRumus && Number.isFinite(rawQty) && rawQty === 0) continue;
    const balanceUnit = columns.balanceUnit ? cellText(row.getCell(columns.balanceUnit).value) : "";
    const masterUnit = columns.masterUnit ? cellText(row.getCell(columns.masterUnit).value) : "";
    const unit = balanceUnit || masterUnit;
    const unitCostCell = row.getCell(columns.unitCost!).value;
    const hppMasihRumus = formulaTanpaNilai(unitCostCell);
    const unitCost = numberValue(unitCostCell);
    const batchNo = columns.batchNo ? cellText(row.getCell(columns.batchNo).value) || null : null;
    const expDate = columns.expDate ? excelDate(row.getCell(columns.expDate).value) : null;
    const branchName = columns.branchName ? cellText(row.getCell(columns.branchName).value) || null : null;
    const warehouseName = columns.warehouseName ? cellText(row.getCell(columns.warehouseName).value) || null : null;
    const asOf = columns.asOf ? excelDate(row.getCell(columns.asOf).value) : null;
    const hasBalanceValue = [cellText(rawQtyCell), balanceUnit, cellText(unitCostCell)].some(Boolean);
    if (isCombinedItemWorkbook && !hasBalanceValue) continue;
    if (!itemCode && !unit && !Number.isFinite(rawQty) && !Number.isFinite(unitCost)) continue;
    if (!itemCode) errors.push(`Baris ${rowNo}: Kode Barang wajib diisi`);
    if (qtyMasihRumus) rumusQtyTanpaNilai.push(rowNo);
    else if (!Number.isFinite(rawQty) || rawQty < 0) errors.push(`Baris ${rowNo}: Kuantitas harus angka nol atau lebih`);
    if (!unit) errors.push(`Baris ${rowNo}: Satuan wajib diisi`);
    if (hppMasihRumus) rumusHppTanpaNilai.push(rowNo);
    else if (!Number.isFinite(unitCost) || unitCost < 0) errors.push(`Baris ${rowNo}: HPP harus angka nol atau lebih`);
    if (columns.expDate && row.getCell(columns.expDate).value != null && !expDate) {
      errors.push(`Baris ${rowNo}: Tanggal kedaluwarsa tidak valid`);
    }
    rows.push({ row: rowNo, itemCode, qty: rawQty, unit, unitCost, batchNo, expDate, branchName, warehouseName, asOf });
  }
  const rentang = (baris: number[]) => `${baris.length} baris (${baris.slice(0, 3).join(", ")}${baris.length > 3 ? ", …" : ""})`;
  if (rumusQtyTanpaNilai.length || rumusHppTanpaNilai.length) {
    const kolom = [
      rumusQtyTanpaNilai.length ? `kuantitas pada ${rentang(rumusQtyTanpaNilai)}` : "",
      rumusHppTanpaNilai.length ? `HPP pada ${rentang(rumusHppTanpaNilai)}` : "",
    ].filter(Boolean).join(" dan ");
    errors.push(`${kolom} masih berupa rumus Excel tanpa hasil angka. Buka file sumber beserta data gudang yang dirujuk, pastikan angkanya muncul, lalu simpan atau ekspor ulang sebagai nilai sebelum diunggah.`);
  }
  return { rows, errors };
}

export function resolveSaldoAwalRows(
  rows: SaldoAwalDraft[],
  master: ReadonlyMap<string, SaldoAwalMasterItem>,
  warehouseId: string,
) {
  const resolved: ResolvedSaldoAwal[] = rows.map((row) => {
    const item = master.get(row.itemCode.trim().toLowerCase());
    let reason: string | null = null;
    let factor = 1;
    if (!item) reason = "Kode barang tidak ditemukan";
    else if (item.itemType !== "Persediaan") reason = "Jasa atau non-persediaan dilewati";
    else if (!item.unit) reason = "Satuan dasar barang belum tersedia";
    else if (row.unit.trim().toLowerCase() !== item.unit.trim().toLowerCase()) {
      factor = item.units.find((unit) => unit.unit.trim().toLowerCase() === row.unit.trim().toLowerCase())?.factor ?? 0;
      if (!factor) reason = "Satuan tidak terdaftar di master barang";
    }
    if (!reason && item?.trackExpiry && row.qty > 0 && !row.expDate) reason = "Tanggal kedaluwarsa wajib untuk barang bertanggal";
    if (!reason && row.expDate && row.expDate < "1900-01-01") reason = "Tanggal kedaluwarsa tidak valid";
    const converted = toBaseStock({ qty: row.qty, factor, unitCost: row.unitCost });
    const skipped = !reason && converted.baseQty === 0;
    return {
      ...row,
      itemId: item?.id ?? "",
      baseQty: converted.baseQty,
      baseUnitCost: converted.baseUnitCost,
      value: converted.value,
      warehouseId,
      status: reason ? (item && item.itemType !== "Persediaan" ? "skipped" : "rejected") : skipped ? "skipped" : "valid",
      reason: reason ?? (skipped ? "Saldo nol dilewati" : null),
    };
  });
  const grouped = new Map<string, ResolvedSaldoAwal[]>();
  const passthrough = resolved.filter((row) => row.status !== "valid");
  for (const row of resolved.filter((item) => item.status === "valid")) {
    const key = stockKey({
      row: row.row,
      warehouseId: row.warehouseId,
      itemId: row.itemId,
      batchNo: row.batchNo,
      expDate: row.expDate,
    });
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const merged = [...grouped.values()].flatMap((group) => {
    if (group.length === 1) return group;
    const sourceRows = group.map((row) => row.row).sort((a, b) => a - b);
    const firstCost = group[0].baseUnitCost;
    if (group.some((row) => Math.abs(row.baseUnitCost - firstCost) > 0.000001)) {
      return group.map((row) => ({
        ...row,
        status: "rejected" as const,
        reason: "Saldo ganda dengan harga dasar berbeda",
        sourceRows,
      }));
    }
    const first = group[0];
    const baseQty = group.reduce((total, row) => total + row.baseQty, 0);
    const value = group.reduce((total, row) => total + row.value, 0);
    return [{
      ...first,
      baseQty,
      value,
      baseUnitCost: baseQty > 0 ? value / baseQty : firstCost,
      sourceRows,
    }];
  });
  return [...passthrough, ...merged].sort((a, b) => a.row - b.row);
}
