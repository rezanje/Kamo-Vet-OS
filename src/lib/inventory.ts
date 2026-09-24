import { hariIniWIB } from "./tanggal";
// Inventori FIFO — SATU pintu untuk semua mutasi stok (PRD §10.2).
// consumeLayers = pure (dites); stockIn/stockOut/transfer = wrapper supabase.
// Mutasi keluar dijalankan di RPC agar konsisten dengan repricing layer faktur.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type Layer = { id: string; qty_left: number; unit_cost: number; exp_date?: string | null };
export type Consumption = {
  takes: { id: string; qty: number; unit_cost: number; exp_date?: string | null }[];
  cost: number;       // total nilai yang terkonsumsi dari layer
  shortfall: number;  // qty yang tidak tercover layer (stok pra-FIFO / minus)
};

// FIFO murni: habiskan layer berurutan (pemanggil wajib mengurutkan tanggal/created_at ASC).
export function consumeLayers(layers: Layer[], qty: number): Consumption {
  const takes: Consumption["takes"] = [];
  let sisa = qty;
  let cost = 0;
  for (const l of layers) {
    if (sisa <= 0) break;
    const ambil = Math.min(Number(l.qty_left), sisa);
    if (ambil <= 0) continue;
    takes.push({ id: l.id, qty: ambil, unit_cost: Number(l.unit_cost), exp_date: l.exp_date ?? null });
    cost += ambil * Number(l.unit_cost);
    sisa -= ambil;
  }
  return { takes, cost, shortfall: Math.max(0, sisa) };
}

/**
 * Lapisan yang harus dibuat di gudang tujuan saat barang dipindah.
 *
 * Kadaluarsa menempel di LAPISAN, bukan di barang — jadi satu pengiriman bisa
 * mengambil dari dua lapisan bertanggal beda, dan gudang tujuan harus menerima
 * dua lapisan juga. Kalau semuanya dilebur jadi satu lapisan tanpa tanggal
 * (perilaku lama), barang yang pindah ke cabang hilang dari Monitor Kadaluarsa
 * dan bisa terjual lewat tanggal tanpa peringatan.
 */
export function lapisanPindahan(
  takes: Consumption["takes"],
  shortfall: number,
  hargaBeliCadangan: number,
): { qty: number; unitCost: number; expDate: string | null }[] {
  const perTanggal = new Map<string, { qty: number; nilai: number; expDate: string | null }>();
  for (const t of takes) {
    const exp = t.exp_date ?? null;
    const kunci = exp ?? "";
    const cur = perTanggal.get(kunci) ?? { qty: 0, nilai: 0, expDate: exp };
    cur.qty += t.qty;
    cur.nilai += t.qty * Number(t.unit_cost);
    perTanggal.set(kunci, cur);
  }
  // Qty tanpa lapisan (stok pra-FIFO) ikut pindah tanpa tanggal — nilainya
  // memakai harga beli master, sama seperti perhitungan cost di stockOut.
  if (shortfall > 0) {
    const cur = perTanggal.get("") ?? { qty: 0, nilai: 0, expDate: null };
    cur.qty += shortfall;
    cur.nilai += shortfall * hargaBeliCadangan;
    perTanggal.set("", cur);
  }
  return [...perTanggal.values()]
    .filter((g) => g.qty > 0)
    .map((g) => ({ qty: g.qty, unitCost: g.nilai / g.qty, expDate: g.expDate }));
}

// Kegagalan tulis stok WAJIB meledak, bukan didiamkan: dokumen penerimaan yang
// bilang "berhasil" padahal stok tidak bertambah adalah bug yang mahal.
export class StockError extends Error {}

function orThrow(error: { message?: string } | null, what: string) {
  if (error) throw new StockError(`${what}: ${error.message ?? "gagal"}`);
}

// Jasa & Non-Persediaan tidak punya stok: memindahkannya bukan error pemakai,
// cuma tidak ada artinya. Dilewati DIAM-DIAM di sini supaya penjualan yang
// mencampur barang & jasa tetap jalan — trigger DB (0081) tinggal jadi jaring
// pengaman untuk jalur yang lupa memanggil lewat sini.
async function punyaStok(supabase: AnyClient, itemId: string): Promise<boolean> {
  const { data } = await supabase.from("items").select("item_type").eq("id", itemId).maybeSingle();
  return !data?.item_type || data.item_type === "Persediaan";
}

export type StockInOpts = {
  warehouseId: string; itemId: string; qty: number; unitCost: number;
  source: string; ref?: string | null; tanggal?: string;
  /** Kadaluarsa kiriman ini (migrasi 0104) — menempel di lapisan, bukan di barang. */
  expDate?: string | null;
};

/**
 * Berapa unit dari barang masuk yang habis untuk MENUTUP stok minus lebih dulu.
 *
 * Stok bisa minus karena barang terjual padahal saldonya kosong: `stockOut`
 * menurunkan `stock.qty` tapi tidak punya lapisan untuk dikonsumsi. Barangnya
 * memang sudah keluar dari rak — jadi begitu kedatangannya dicatat belakangan,
 * unit sebanyak itu TIDAK boleh berdiri lagi sebagai lapisan siap jual, karena
 * fisiknya sudah tidak ada.
 *
 * Tanpa aturan ini, tabel lapisan menyimpan barang hantu: `stock.qty` benar
 * tetapi lapisannya kelebihan, dan FIFO bisa menjual sesuatu yang sudah habis.
 */
export function porsiPenutupMinus(stokSekarang: number, qtyMasuk: number): { menutup: number; jadiLapisan: number } {
  const minus = Math.max(0, -(Number(stokSekarang) || 0));
  const masuk = Math.max(0, Number(qtyMasuk) || 0);
  const menutup = Math.min(minus, masuk);
  return { menutup, jadiLapisan: masuk - menutup };
}

// Stok masuk: buat layer baru + naikkan qty.
export async function stockIn(supabase: AnyClient, o: StockInOpts): Promise<void> {
  if (o.qty <= 0) return;
  if (!(await punyaStok(supabase, o.itemId))) return;

  const { error } = await supabase.rpc("stock_in_fifo", {
    p_warehouse_id: o.warehouseId,
    p_item_id: o.itemId,
    p_qty: o.qty,
    p_unit_cost: o.unitCost,
    p_source: o.source,
    p_source_ref: o.ref ?? null,
    p_tanggal: o.tanggal ?? hariIniWIB(),
    p_exp_date: o.expDate ?? null,
  });
  orThrow(error, "catat stok masuk");
}

export type StockOutOpts = {
  warehouseId: string; itemId: string; qty: number;
  source: string; ref?: string | null;
};

// Stok keluar: konsumsi layer FIFO, turunkan qty, kembalikan total cost (HPP riil).
// Shortfall (layer tidak cukup) dihargai items.buy_price — tidak membuat layer negatif.
// `takes` & `shortfall` dikembalikan supaya pemanggil yang memindahkan barang bisa
// membangun ulang lapisan (beserta kadaluarsanya) di gudang tujuan.
export async function stockOut(
  supabase: AnyClient,
  o: StockOutOpts,
): Promise<{ cost: number; takes: Consumption["takes"]; shortfall: number; hargaBeli: number }> {
  if (o.qty <= 0) return { cost: 0, takes: [], shortfall: 0, hargaBeli: 0 };
  // Jasa tidak mengurangi stok DAN tidak punya HPP persediaan — cost 0, bukan error.
  if (!(await punyaStok(supabase, o.itemId))) return { cost: 0, takes: [], shortfall: 0, hargaBeli: 0 };

  const { data, error } = await supabase.rpc("stock_out_fifo", {
    p_warehouse_id: o.warehouseId,
    p_item_id: o.itemId,
    p_qty: o.qty,
    p_source: o.source,
    p_source_ref: o.ref ?? null,
    p_tanggal: hariIniWIB(),
  });
  orThrow(error, "keluarkan stok");
  const result = (Array.isArray(data) ? data[0] : data) as {
    cost?: number | string;
    takes?: { id: string; qty: number | string; unit_cost: number | string; exp_date?: string | null }[];
    shortfall?: number | string;
    harga_beli?: number | string;
  } | null;
  if (!result) throw new StockError("keluarkan stok: hasil transaksi kosong");
  return {
    cost: Number(result.cost) || 0,
    takes: (result.takes ?? []).map((take) => ({
      id: take.id,
      qty: Number(take.qty) || 0,
      unit_cost: Number(take.unit_cost) || 0,
      exp_date: take.exp_date ?? null,
    })),
    shortfall: Number(result.shortfall) || 0,
    hargaBeli: Number(result.harga_beli) || 0,
  };
}

// Stok masuk dgn cost = items.buy_price (penerimaan internal / penyesuaian manual).
export async function stockInAtBuyPrice(
  supabase: AnyClient,
  o: { warehouseId: string; itemId: string; qty: number; source: string; ref?: string | null; tanggal?: string },
): Promise<void> {
  if (o.qty <= 0) return;
  const { data: item } = await supabase.from("items").select("buy_price").eq("id", o.itemId).maybeSingle();
  await stockIn(supabase, { ...o, unitCost: Number(item?.buy_price) || 0 });
}

// Pindah gudang: cost FIFO DAN tanggal kadaluarsa ikut barang. Satu lapisan dibuat
// di gudang tujuan untuk tiap tanggal kadaluarsa yang terkonsumsi di gudang asal.
export async function transferStock(
  supabase: AnyClient,
  o: { fromWarehouseId: string; toWarehouseId: string; itemId: string; qty: number; source: string; ref?: string | null; tanggal?: string },
): Promise<void> {
  if (o.qty <= 0) return;
  const { takes, shortfall, hargaBeli } = await stockOut(supabase, {
    warehouseId: o.fromWarehouseId, itemId: o.itemId, qty: o.qty, source: o.source, ref: o.ref,
  });
  for (const g of lapisanPindahan(takes, shortfall, hargaBeli)) {
    await stockIn(supabase, {
      warehouseId: o.toWarehouseId, itemId: o.itemId, qty: g.qty,
      unitCost: g.unitCost, expDate: g.expDate,
      source: o.source, ref: o.ref, tanggal: o.tanggal,
    });
  }
}
