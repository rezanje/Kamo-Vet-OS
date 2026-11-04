import type { RanapPaymentQuote } from "@/lib/ranap-payment";
import type { ServicePerformersSnapshot } from "@/lib/service-performers";
import type { ResepPaket } from "@/lib/paket-klinik";
import type { PackagePrintSource } from "@/lib/clinic-package-print";
export type InpatientHistoryRow = PackagePrintSource & { id: string; package_name?: string | null };

type PackageOption = { id: string; componentIds: string[]; perPaket?: Record<string, number>; resep?: ResepPaket };
type PackageMaster = { id: string; unit: string; paket?: boolean; units?: { unit: string; factor: number }[] };
type PackageLine = { item_id?: string | null; qty: number; satuan?: string | null; jenis?: string | null; recipe_id?: string | null; package_item_id?: string | null; package_qty?: number | null };
const PACKAGE_ERROR = "Resep / asal paket belum dapat diverifikasi. Muat ulang sebelum memproses uang.";
const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-8;
const factorFor = (item: PackageMaster, unit: string | null | undefined) => unit === item.unit ? 1 : item.units?.find(option => option.unit === unit)?.factor;

/** Validate complete explicit metadata, never infer origin from matching price/recipe. */
export function inpatientPackageOptionError(option: PackageOption | undefined, obat: PackageMaster[], jasa: PackageMaster[]): string | null {
  if (!option?.resep || option.resep.id !== option.id || !obat.some(item => item.id === option.id && item.paket)
    || !Array.isArray(option.resep.komponen) || !option.resep.komponen.length || !option.perPaket || !Array.isArray(option.componentIds)) return PACKAGE_ERROR;
  const totals = new Map<string, number>();
  for (const component of option.resep.komponen) {
    if (!component.item_id || !component.unit || !component.base_unit || !["Persediaan", "Jasa", "Non-Persediaan"].includes(component.item_type)
      || !Number.isFinite(component.qty) || component.qty <= 0 || !Number.isFinite(component.factor) || component.factor <= 0) return PACKAGE_ERROR;
    if (component.item_type !== "Non-Persediaan") {
      const item = (component.item_type === "Jasa" ? jasa : obat).find(item => item.id === component.item_id && !item.paket);
      if (!item || item.unit !== component.base_unit || !close(Number(factorFor(item, component.unit)), component.factor)) return PACKAGE_ERROR;
    }
    totals.set(component.item_id, (totals.get(component.item_id) ?? 0) + component.qty * component.factor);
  }
  if (new Set(option.componentIds).size !== totals.size || option.componentIds.length !== totals.size
    || Object.keys(option.perPaket).length !== totals.size || [...totals].some(([id, qty]) => !option.componentIds.includes(id) || !close(option.perPaket![id], qty))) return PACKAGE_ERROR;
  return null;
}

/** A tagged pending set must be complete and coherent before projecting a card. */
export function inpatientPackageRowsError(rows: PackageLine[], options: PackageOption[], obat: PackageMaster[], jasa: PackageMaster[]): string | null {
  for (const row of rows) {
    if (obat.some(item => item.paket && item.id === row.item_id)) return PACKAGE_ERROR;
    if ((row.package_item_id != null) !== (row.package_qty != null)) return PACKAGE_ERROR;
  }
  for (const id of new Set(rows.flatMap(row => row.package_item_id != null ? [row.package_item_id] : []))) {
    const option = options.find(option => option.id === id);
    if (inpatientPackageOptionError(option, obat, jasa)) return PACKAGE_ERROR;
    const tagged = rows.filter(row => row.package_item_id === id);
    const count = Number(tagged[0].package_qty);
    if (!Number.isInteger(count) || count < 1) return PACKAGE_ERROR;
    const expected = new Map<string, { qty: number; kind: string }>();
    for (const component of option!.resep!.komponen.filter(component => component.item_type !== "Non-Persediaan")) {
      expected.set(component.item_id, { qty: (expected.get(component.item_id)?.qty ?? 0) + component.qty * component.factor * count, kind: component.item_type === "Jasa" ? "jasa" : "obat" });
    }
    const actual = new Map<string, number>();
    for (const row of tagged) {
      const item = [...obat, ...jasa].find(item => item.id === row.item_id);
      if (!item || !row.item_id || row.recipe_id || Number(row.package_qty) !== count || !Number.isFinite(row.qty) || row.qty <= 0
        || expected.get(row.item_id)?.kind !== row.jenis) return PACKAGE_ERROR;
      const factor = factorFor(item, row.satuan);
      if (factor == null || !Number.isFinite(factor) || factor <= 0) return PACKAGE_ERROR;
      actual.set(row.item_id, (actual.get(row.item_id) ?? 0) + row.qty * factor);
    }
    if (actual.size !== expected.size || [...expected].some(([id, value]) => !close(actual.get(id) ?? NaN, value.qty))) return PACKAGE_ERROR;
  }
  return null;
}
/** Scale only explicit package rows; retain original allocation, units and source identity. */
export function resizeInpatientPackage<L extends PackageLine>(rows: L[], id: string, count: number): L[] {
  if (!Number.isInteger(count) || count < 1) return rows;
  const tagged = rows.filter(row => row.package_item_id === id);
  const previous = Number(tagged[0]?.package_qty);
  if (!tagged.length || !Number.isInteger(previous) || previous < 1 || tagged.some(row => Number(row.package_qty) !== previous)) return rows;
  return rows.map(row => row.package_item_id === id ? { ...row, qty: row.qty * count / previous, package_qty: count } : row);
}

export type InpatientCashierRow = { id:string; medical_record_id?:string; item_id:string|null; nama_obat:string; qty:number; harga:number; satuan:string|null; jenis:string; compound_recipe_id?:string|null; bmhp_components?:unknown; package_item_id?:string|null; package_qty?:number|null; service_performers?:ServicePerformersSnapshot|null;
  /** true = baris pending ini masih menunjuk invoice yang dibatalkan/terbit ulang: pelaksananya tersegel (database menolak penggantian). */ performers_sealed?:boolean };
export type InpatientCashierReadOnly = Pick<InpatientCashierData,"history"|"receipts"|"applications"> & {state:"SHIFT_REQUIRED";quote:null;snapshot:null};
export type InpatientCashierData = {state?:"EDITABLE";compound_pending?:boolean;tax_settings:{mode_pkp:boolean;ppn_rate:number|string};snapshot:string;rows:InpatientCashierRow[];quote:RanapPaymentQuote;history:{id:string;invoice_no:string;total:number;received:number;dp_amount:number;paid_status:string;correction_pending:boolean;lines:InpatientHistoryRow[]}[];receipts:{id:string;no_kwitansi:string;total:number;status:string;parts:{metode:string;amount:number}[]}[];applications:{id:string;invoice_id:string;amount:number;released_at:string|null}[]};
