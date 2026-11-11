/* eslint-disable @typescript-eslint/no-explicit-any */
import { batasTanggalWIB } from "./laporan-transaksi";
import { completeReportQuery } from "./report-query";
import { inventoryMethod } from "./hpp-reports-server";
import { valueInventory } from "./hpp-reports";
import { hariIniWIB } from "./tanggal";
import {
  rekapPerCabang,
  rentangBulanLalu,
  nilaiStokPadaTanggal,
  unitGudang,
  type AngkaCabang,
  type DokumenUnit,
  type MutasiNilai,
  type NilaiStok,
} from "./perbandingan-cabang";
import type { DashboardScope, SalesDocument } from "./operation-sales-server";

type AnyClient = any;

export type BarisPerbandingan = {
  branchId: string;
  branchName: string;
  sekarang: AngkaCabang;
  bulanLalu: AngkaCabang;
};

export type PerbandinganBlock = {
  periode: { from: string; to: string };
  pembanding: { from: string; to: string };
  rows: BarisPerbandingan[];
  total: BarisPerbandingan;
};

export type BarisNilaiStok = { branchId: string; branchName: string; sekarang: NilaiStok; bulanLalu: NilaiStok };

export type NilaiStokBlock = {
  tanggal: string;
  tanggalPembanding: string;
  metode: "fifo" | "moving_average";
  rows: BarisNilaiStok[];
  total: BarisNilaiStok;
};

const CONCURRENCY = 6;

async function readAll<T>(query: AnyClient): Promise<T[]> {
  return (await completeReportQuery<T>(query)).data;
}

/** Satu bacaan lengkap per id (gudang), maksimal 6 sekaligus: tiap gudang dibaca berhalaman sendiri. */
async function readPerId<T>(ids: string[], query: (id: string) => AnyClient): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += CONCURRENCY) {
    const pages = await Promise.all(ids.slice(index, index + CONCURRENCY).map((id) => readAll<T>(query(id))));
    for (const page of pages) rows.push(...page);
  }
  return rows;
}

function toUnitDocs(documents: SalesDocument[]): DokumenUnit[] {
  return documents.flatMap((document) => document.origin === "reseller" ? [] : [{
    unit: document.origin,
    documentId: document.rows[0]?.saleId ?? "",
    branchId: document.branchId,
    customerId: document.customerId,
    net: document.rows.reduce((sum, row) => sum + (Number(row.net) || 0), 0),
  }]);
}

/**
 * Grooming per cabang, aturannya sama dengan kartu "Grooming hari ini" di Dashboard
 * Operasional: kunjungan klinik poli grooming yang terdaftar (semua status, kecuali
 * diarsipkan) + jumlah layanan grooming yang dijual lewat kasir (struk batal tidak dihitung).
 */
export async function groomingPerCabang(supabase: AnyClient, scope: DashboardScope, from: string, to: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (scope.branchIds.length === 0) return out;
  const { mulai, akhir } = batasTanggalWIB(from, to);
  const [visits, kasir] = await Promise.all([
    readAll<{ id: string; branch_id: string }>(supabase.from("visits")
      .select("id,branch_id", { count: "exact" }).is("archived_at", null).ilike("poli", "%grooming%")
      .in("branch_id", scope.branchIds).gte("created_at", mulai).lte("created_at", akhir)),
    readAll<{ id: string; qty: number | string | null; sales: { branch_id: string } | { branch_id: string }[] | null }>(supabase.from("sale_items")
      .select("id,qty,sales!inner(created_at,voided_at,branch_id),items!inner(item_type,tindakan_kategori)", { count: "exact" })
      .eq("items.item_type", "Jasa").eq("items.tindakan_kategori", "Grooming")
      .is("sales.voided_at", null).in("sales.branch_id", scope.branchIds)
      .gte("sales.created_at", mulai).lte("sales.created_at", akhir)),
  ]);
  for (const visit of visits) out.set(visit.branch_id, (out.get(visit.branch_id) ?? 0) + 1);
  for (const line of kasir) {
    const sale = Array.isArray(line.sales) ? line.sales[0] : line.sales;
    if (!sale) continue;
    out.set(sale.branch_id, (out.get(sale.branch_id) ?? 0) + (Number(line.qty) || 0));
  }
  for (const [id, value] of out) out.set(id, Math.round(value * 10_000) / 10_000);
  return out;
}

export async function collectPerbandinganBlock(
  supabase: AnyClient,
  scope: DashboardScope,
  periode: { from: string; to: string },
  loadDocuments: (range: { from: string; to: string }) => Promise<{ documents: SalesDocument[] }>,
): Promise<PerbandinganBlock> {
  const pembanding = rentangBulanLalu(periode.from, periode.to);
  const [now, prev, groomNow, groomPrev] = await Promise.all([
    loadDocuments(periode),
    loadDocuments(pembanding),
    groomingPerCabang(supabase, scope, periode.from, periode.to),
    groomingPerCabang(supabase, scope, pembanding.from, pembanding.to),
  ]);
  const current = rekapPerCabang(scope.branchIds, toUnitDocs(now.documents), groomNow);
  const previous = rekapPerCabang(scope.branchIds, toUnitDocs(prev.documents), groomPrev);
  const row = (branchId: string, branchName: string): BarisPerbandingan => ({
    branchId, branchName, sekarang: current.get(branchId)!, bulanLalu: previous.get(branchId)!,
  });
  return {
    periode,
    pembanding,
    rows: scope.branches.map((branch) => row(branch.id, branch.name)),
    total: row("*", "Total"),
  };
}

type Warehouse = { id: string; branch_id: string; type: string | null };
type StockRow = { id: string; warehouse_id: string; item_id: string; qty: number | string; average_cost?: number | string | null };
type LayerRow = { id: string; warehouse_id: string; item_id: string; qty_left: number | string; unit_cost: number | string };
type MoveRow = { id: string; warehouse_id: string; tanggal: string; qty: number | string; unit_cost: number | string; valuation_adjustment: number | string | null };

/**
 * Nilai stok (HPP) gudang petshop & klinik per cabang, akhir hari `tanggal` dan akhir hari
 * yang sama bulan lalu. Nilai hari ini = cara Laporan Nilai Persediaan (sisa lapisan FIFO,
 * atau qty × HPP rata-rata bila metode rata-rata aktif). Tanggal lampau dihitung mundur:
 * nilai hari ini dikurangi nilai semua mutasi kartu stok yang tanggalnya sesudah tanggal itu.
 */
export async function collectNilaiStokBlock(supabase: AnyClient, scope: DashboardScope, tanggal: string): Promise<NilaiStokBlock> {
  const today = hariIniWIB();
  const asOf = tanggal > today ? today : tanggal;
  const { to: tanggalPembanding } = rentangBulanLalu(asOf, asOf);
  const warehouses = scope.branchIds.length === 0 ? [] : (await readAll<Warehouse>(supabase.from("warehouses")
    .select("id,branch_id,type", { count: "exact" }).in("branch_id", scope.branchIds)))
    .filter((warehouse) => unitGudang(warehouse.type) !== null);
  const ids = warehouses.map((warehouse) => warehouse.id);
  const method = await inventoryMethod(supabase);
  const [stock, layers, moves] = await Promise.all([
    readPerId<StockRow>(ids, (id) => supabase.from("stock")
      .select(`id,warehouse_id,item_id,qty${method === "moving_average" ? ",average_cost" : ""}`, { count: "exact" }).eq("warehouse_id", id)),
    readPerId<LayerRow>(ids, (id) => supabase.from("stock_layers")
      .select("id,warehouse_id,item_id,qty_left,unit_cost", { count: "exact" }).eq("warehouse_id", id).gt("qty_left", 0)),
    readPerId<MoveRow>(ids, (id) => supabase.from("stock_moves")
      .select("id,warehouse_id,tanggal,qty,unit_cost,valuation_adjustment", { count: "exact" }).eq("warehouse_id", id).gt("tanggal", tanggalPembanding)),
  ]);
  const values = valueInventory(
    stock.map((row) => ({ warehouseId: row.warehouse_id, itemId: row.item_id, qty: row.qty, averageCost: row.average_cost ?? undefined })),
    layers.map((row) => ({ warehouseId: row.warehouse_id, itemId: row.item_id, qtyLeft: row.qty_left, unitCost: row.unit_cost })),
    method,
  );
  const nilaiSekarang = new Map<string, number>();
  for (const row of values) nilaiSekarang.set(row.warehouseId, (nilaiSekarang.get(row.warehouseId) ?? 0) + row.pricedValue);
  const mutasi: MutasiNilai[] = moves.map((move) => ({
    warehouseId: move.warehouse_id,
    tanggal: String(move.tanggal).slice(0, 10),
    qty: Number(move.qty) || 0,
    unitCost: Number(move.unit_cost) || 0,
    valuationAdjustment: Number(move.valuation_adjustment) || 0,
  }));
  const gudang = warehouses.map((warehouse) => ({ id: warehouse.id, branchId: warehouse.branch_id, type: warehouse.type }));
  const current = nilaiStokPadaTanggal({ tanggal: asOf, warehouses: gudang, nilaiSekarang, mutasi, branchIds: scope.branchIds });
  const previous = nilaiStokPadaTanggal({ tanggal: tanggalPembanding, warehouses: gudang, nilaiSekarang, mutasi, branchIds: scope.branchIds });
  const row = (branchId: string, branchName: string): BarisNilaiStok => ({
    branchId, branchName, sekarang: current.get(branchId)!, bulanLalu: previous.get(branchId)!,
  });
  return {
    tanggal: asOf,
    tanggalPembanding,
    metode: method,
    rows: scope.branches.map((branch) => row(branch.id, branch.name)),
    total: row("*", "Total"),
  };
}
