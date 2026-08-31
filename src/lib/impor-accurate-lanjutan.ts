export type SourceRow = { row_no: number; code: string; name: string };
export type FileRows = { file: string; rows: SourceRow[] };
export type RejectedSource = { source: string; code: string; reason: string };
export type RowIssue = { row: number; reason: string };

export type SaldoAwalDraft = {
  row: number;
  code: string;
  warehouse: string;
  qty: number;
  unit: string;
  unitCost: number | null;
  asOf: string;
  batchNo?: string | null;
  expDate?: string | null;
};

export type SaldoAwalValid = SaldoAwalDraft & { baseQty: number; baseUnitCost: number };

export type KomponenGrupDraft = {
  row: number;
  groupCode: string;
  componentCode: string;
  qty: number;
  unit: string;
  sortOrder: number;
};

export type ResolvedGroupComponent = {
  groupCode: string;
  componentId: string;
  qty: number;
  unit: string;
  factor: number;
  sortOrder: number;
};

export type GroupRpcRow = {
  component_item_id: string;
  qty: number;
  unit: string;
  factor?: number;
  sort_order: number;
};

type MasterLite = {
  id?: string;
  itemType: string;
  unit: string;
  isActive?: boolean;
  trackExpiry?: boolean;
  units?: { unit: string; factor: number }[];
};

const key = (value: string) => value.trim().toUpperCase();

export function gabungWorkbookAccurate(files: FileRows[]) {
  const count = new Map<string, number>();
  for (const file of files) for (const row of file.rows) {
    const rowKey = key(row.code);
    if (rowKey) count.set(rowKey, (count.get(rowKey) ?? 0) + 1);
  }
  const duplicates = new Set([...count].filter(([, n]) => n > 1).map(([rowKey]) => rowKey));
  return {
    rows: files.flatMap((file) => file.rows.filter((row) => !duplicates.has(key(row.code)))),
    rejected: files.flatMap((file) => file.rows
      .filter((row) => duplicates.has(key(row.code)))
      .map((row) => ({ source: `${file.file}:${row.row_no}`, code: row.code, reason: "Kode kembar lintas-file" }))),
  };
}

function factorFor(item: MasterLite, unit: string) {
  if (item.unit.trim().toLowerCase() === unit.trim().toLowerCase()) return 1;
  return item.units?.find((candidate) => candidate.unit.trim().toLowerCase() === unit.trim().toLowerCase())?.factor ?? null;
}

export function parseSaldoAwalRows(rows: SaldoAwalDraft[], master: Map<string, MasterLite>) {
  const valid: SaldoAwalValid[] = [];
  const rejected: RowIssue[] = [];
  for (const row of rows) {
    const item = master.get(key(row.code));
    const factor = item ? factorFor(item, row.unit) : null;
    const reason = !item ? "Kode barang tidak ditemukan"
      : item.itemType !== "Persediaan" ? "Saldo hanya untuk Persediaan"
      : !Number.isFinite(row.qty) || row.qty < 0 ? "Kuantitas tidak valid"
      : row.unitCost == null || !Number.isFinite(row.unitCost) || row.unitCost < 0 ? "HPP wajib diisi"
      : factor == null || !Number.isFinite(factor) || factor <= 0 ? "Satuan tidak dikenal"
      : item.isActive === false ? "Barang tidak aktif"
      : item.units?.some((candidate) => candidate.factor <= 0) ? "Faktor satuan master tidak valid"
      : item.trackExpiry && row.qty > 0 && !row.expDate
        ? "Tanggal kedaluwarsa wajib" : null;
    if (reason) {
      rejected.push({ row: row.row, reason });
    } else {
      valid.push({
        ...row,
        baseQty: row.qty * factor!,
        baseUnitCost: row.unitCost! / factor!,
      });
    }
  }
  return { valid, rejected };
}

export type GroupMasterLite = MasterLite & { id?: string };

export function parseKomponenGrupRows(rows: KomponenGrupDraft[], master: Map<string, GroupMasterLite>) {
  const valid: ResolvedGroupComponent[] = [];
  const rejected: RowIssue[] = [];
  const groups = new Set<string>();
  for (const row of rows) {
    groups.add(key(row.groupCode));
    const group = master.get(key(row.groupCode));
    const component = master.get(key(row.componentCode));
    const factor = component ? factorFor(component, row.unit) : null;
    const reason = !group ? "Kode Grup tidak ditemukan"
      : group.itemType !== "Grup" ? "Kode induk bukan Grup"
      : !component ? "Kode komponen tidak ditemukan"
      : component.itemType === "Grup" ? "Grup bertingkat tidak didukung"
      : component.isActive === false ? "Komponen tidak aktif"
      : key(row.groupCode) === key(row.componentCode) ? "Komponen tidak boleh sama dengan Grup"
      : !Number.isFinite(row.qty) || row.qty <= 0 ? "Kuantitas komponen harus lebih dari 0"
      : factor == null || !Number.isFinite(factor) || factor <= 0 ? "Satuan/faktor komponen tidak dikenal" : null;
    if (reason) {
      rejected.push({ row: row.row, reason });
    } else {
      valid.push({
        groupCode: row.groupCode,
        componentId: component!.id ?? row.componentCode,
        qty: row.qty,
        unit: row.unit,
        factor: factor!,
        sortOrder: Number.isFinite(row.sortOrder) ? row.sortOrder : 0,
      });
    }
  }
  return { valid, rejected, incompleteGroups: [...groups].filter((groupCode) => !valid.some((row) => key(row.groupCode) === groupCode)) };
}

export function groupComponentPayload(rows: ResolvedGroupComponent[]) {
  const out = new Map<string, GroupRpcRow[]>();
  for (const row of [...rows].sort((a, b) => a.groupCode.localeCompare(b.groupCode) || a.sortOrder - b.sortOrder)) {
    const list = out.get(row.groupCode) ?? [];
    list.push({ component_item_id: row.componentId, qty: row.qty, unit: row.unit, sort_order: row.sortOrder });
    out.set(row.groupCode, list);
  }
  return out;
}

export const fingerprintInput = (files: { name: string; size: number }[]) => files
  .map((file) => `${file.name}:${file.size}`)
  .sort()
  .join("|");

export const stockKey = (row: { warehouseId: string; itemId: string; batchNo?: string | null; expDate?: string | null }) => [
  row.warehouseId, row.itemId, row.batchNo ?? "", row.expDate ?? "",
].join("|");

export function duplicateStockKeys<T extends { row: number; warehouseId: string; itemId: string; batchNo?: string | null; expDate?: string | null }>(rows: T[]) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(stockKey(row), (counts.get(stockKey(row)) ?? 0) + 1);
  return rows.filter((row) => (counts.get(stockKey(row)) ?? 0) > 1).map(({ row }) => ({ row, reason: "Baris saldo kembar" }));
}
