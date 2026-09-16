import { hariIniWIB } from "./tanggal";
import { urutFefo, type LapisanFefo } from "./kadaluarsa-batch";
// Inventori FIFO — SATU pintu untuk semua mutasi stok (PRD §10.2).
// consumeLayers = pure (dites); stockIn/stockOut/transfer = wrapper supabase.
// ponytail: mutasi JS read-then-update mengikuti pola existing repo; kalau race
// jadi masalah nyata di produksi, pindahkan ke RPC Postgres satu transaksi.

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

// Kartu stok (migrasi 0074): satu baris per mutasi, ditulis di pintu yang sama
// dengan perubahan qty supaya tidak ada mutasi yang lolos tanpa jejak.
// Gagal mencatat jejak TIDAK membatalkan mutasinya — stok yang benar lebih penting
// daripada kartu stok yang lengkap; kegagalannya tetap muncul di log server.
async function catatMutasi(
  supabase: AnyClient,
  o: { warehouseId: string; itemId: string; qty: number; unitCost: number; source: string; ref?: string | null; tanggal?: string },
) {
  const { error } = await supabase.from("stock_moves").insert({
    tanggal: o.tanggal ?? hariIniWIB(),
    warehouse_id: o.warehouseId, item_id: o.itemId, qty: o.qty,
    unit_cost: o.unitCost, source: o.source, source_ref: o.ref ?? null,
  });
  if (error) console.error("[kartu-stok] gagal catat mutasi:", error.message);
}

async function adjustStockQty(supabase: AnyClient, warehouseId: string, itemId: string, delta: number) {
  const { data: st, error: readErr } = await supabase
    .from("stock").select("qty")
    .eq("warehouse_id", warehouseId).eq("item_id", itemId).maybeSingle();
  orThrow(readErr, "baca stok");
  if (st) {
    const { error } = await supabase.from("stock")
      .update({ qty: Number(st.qty) + delta, updated_at: new Date().toISOString() })
      .eq("warehouse_id", warehouseId).eq("item_id", itemId);
    orThrow(error, "ubah stok");
  } else {
    const { error } = await supabase.from("stock").insert({ warehouse_id: warehouseId, item_id: itemId, qty: delta });
    orThrow(error, "buat stok");
  }
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

  // Stok minus ditutup DULU; sisanya baru jadi lapisan siap jual.
  const { data: st } = await supabase
    .from("stock").select("qty")
    .eq("warehouse_id", o.warehouseId).eq("item_id", o.itemId).maybeSingle();
  const { jadiLapisan } = porsiPenutupMinus(Number(st?.qty) || 0, o.qty);

  if (jadiLapisan > 0) {
    const { error } = await supabase.from("stock_layers").insert({
      warehouse_id: o.warehouseId, item_id: o.itemId,
      tanggal: o.tanggal ?? hariIniWIB(),
      qty_in: jadiLapisan, qty_left: jadiLapisan, unit_cost: o.unitCost,
      source: o.source, source_ref: o.ref ?? null,
      exp_date: o.expDate || null,
    });
    orThrow(error, "catat lapisan stok masuk");
  }
  // Saldo tetap naik sebanyak yang datang — porsi penutup minus mengangkat
  // saldonya dari negatif ke nol, bukan menghilang.
  await adjustStockQty(supabase, o.warehouseId, o.itemId, o.qty);
  await catatMutasi(supabase, { ...o, qty: o.qty });
}

export type StockOutOpts = {
  warehouseId: string; itemId: string; qty: number;
  source: string; ref?: string | null;
};

// Pemeriksaan sebelum dokumen penjualan dibuat. stockOut mengulang pemeriksaan
// saat eksekusi; pemeriksaan awal mencegah transaksi setengah jadi pada stok kurang.
export async function pastikanStokSiap(
  supabase: AnyClient,
  warehouseId: string | null,
  kebutuhan: { itemId: string; qty: number }[],
): Promise<void> {
  const jumlah = new Map<string, number>();
  for (const baris of kebutuhan) {
    if (!Number.isFinite(baris.qty) || baris.qty <= 0) throw new StockError("Jumlah barang tidak valid");
    jumlah.set(baris.itemId, (jumlah.get(baris.itemId) ?? 0) + baris.qty);
  }
  const ids = [...jumlah.keys()];
  if (ids.length === 0) return;
  const { data: items, error: itemErr } = await supabase.from("items")
    .select("id, name, item_type, buy_price").in("id", ids);
  orThrow(itemErr, "baca master barang");
  if ((items ?? []).length !== ids.length) throw new StockError("Ada barang yang tidak ditemukan");
  const barang = (items ?? []).filter((item: { item_type: string }) => item.item_type === "Persediaan") as
    { id: string; name: string; buy_price: number }[];
  if (barang.length === 0) return;
  if (!warehouseId) throw new StockError("Cabang belum punya gudang aktif");

  const persediaanIds = barang.map((item) => item.id);
  const [{ data: saldo, error: saldoErr }, { data: lapisan, error: lapisanErr }] = await Promise.all([
    supabase.from("stock").select("item_id, qty")
      .eq("warehouse_id", warehouseId).in("item_id", persediaanIds),
    supabase.from("stock_layers").select("item_id, qty_left, unit_cost, exp_date, tanggal, created_at")
      .eq("warehouse_id", warehouseId).in("item_id", persediaanIds).gt("qty_left", 0),
  ]);
  orThrow(saldoErr, "baca saldo stok");
  orThrow(lapisanErr, "baca modal stok");
  const tersedia = new Map<string, number>((saldo ?? []).map((row: { item_id: string; qty: number }) => [row.item_id, Number(row.qty)]));
  for (const item of barang) {
    const perlu = jumlah.get(item.id) ?? 0;
    if ((tersedia.get(item.id) ?? 0) + Number.EPSILON < perlu) {
      throw new StockError(`Stok ${item.name} tidak cukup: perlu ${perlu}, tersedia ${tersedia.get(item.id) ?? 0}`);
    }
    const layers = urutFefo((lapisan ?? []).filter((row: { item_id: string }) => row.item_id === item.id) as (Layer & LapisanFefo)[]);
    const { takes, shortfall } = consumeLayers(layers, perlu);
    if (takes.some((take) => Number(take.unit_cost) <= 0) || (shortfall > 0 && Number(item.buy_price) <= 0)) {
      throw new StockError(`Modal ${item.name} belum tercatat. Lengkapi harga beli sebelum menjual.`);
    }
  }
}

// Stok keluar: konsumsi layer FIFO, turunkan qty, kembalikan total cost (HPP riil).
// Shortfall (layer tidak cukup) dihargai items.buy_price — tidak membuat layer negatif.
// `takes` & `shortfall` dikembalikan supaya pemanggil yang memindahkan barang bisa
// membangun ulang lapisan (beserta kadaluarsanya) di gudang tujuan.
export async function stockOut(
  supabase: AnyClient,
  o: StockOutOpts,
): Promise<{ cost: number; takes: Consumption["takes"]; shortfall: number; hargaBeli: number }> {
  if (!Number.isFinite(o.qty)) throw new StockError("Jumlah stok keluar tidak valid");
  if (o.qty <= 0) return { cost: 0, takes: [], shortfall: 0, hargaBeli: 0 };
  // Jasa tidak mengurangi stok DAN tidak punya HPP persediaan — cost 0, bukan error.
  if (!(await punyaStok(supabase, o.itemId))) return { cost: 0, takes: [], shortfall: 0, hargaBeli: 0 };

  const { data: saldo, error: saldoErr } = await supabase.from("stock").select("qty")
    .eq("warehouse_id", o.warehouseId).eq("item_id", o.itemId).maybeSingle();
  orThrow(saldoErr, "baca saldo stok");
  if (Number(saldo?.qty ?? 0) + Number.EPSILON < o.qty) {
    throw new StockError(`Stok tidak cukup: perlu ${o.qty}, tersedia ${Number(saldo?.qty ?? 0)}`);
  }

  const { data: layersRaw, error: layerErr } = await supabase
    .from("stock_layers")
    .select("id, qty_left, unit_cost, exp_date, tanggal, created_at")
    .eq("warehouse_id", o.warehouseId).eq("item_id", o.itemId)
    .gt("qty_left", 0)
    .order("tanggal", { ascending: true })
    .order("created_at", { ascending: true });
  orThrow(layerErr, "baca lapisan stok");

  // FEFO: yang paling dekat kadaluarsa keluar duluan (permintaan Pak Faisal,
  // meeting 14 Agustus). Tanpa ini barang bertanggal dekat mengendap di gudang
  // sampai basi, sementara kiriman baru yang masih lama justru terjual.
  // Lapisan tanpa tanggal tetap urut masuk-duluan seperti FIFO lama.
  const layers = urutFefo((layersRaw ?? []) as (Layer & LapisanFefo)[]);

  const { takes, cost, shortfall } = consumeLayers(layers as Layer[], o.qty);

  let extra = 0;
  let hargaBeli = 0;
  if (shortfall > 0) {
    const { data: item, error: itemErr } = await supabase.from("items")
      .select("buy_price").eq("id", o.itemId).maybeSingle();
    orThrow(itemErr, "baca harga beli");
    hargaBeli = Number(item?.buy_price) || 0;
    extra = shortfall * hargaBeli;
  }
  if (["sale", "sale-group", "sale-online", "sales-delivery", "klinik", "racik", "produksi"].includes(o.source)
    && ((shortfall > 0 && hargaBeli <= 0) || takes.some((t) => Number(t.unit_cost) <= 0))) {
    throw new StockError("Modal barang belum tercatat. Lengkapi harga beli sebelum stok dikeluarkan.");
  }

  for (const t of takes) {
    const layer = layers.find((l: Layer) => l.id === t.id);
    const { error } = await supabase.from("stock_layers")
      .update({ qty_left: Number(layer?.qty_left ?? 0) - t.qty })
      .eq("id", t.id);
    orThrow(error, "kurangi lapisan stok");
  }

  await adjustStockQty(supabase, o.warehouseId, o.itemId, -o.qty);
  await catatMutasi(supabase, {
    ...o, qty: -o.qty,
    unitCost: o.qty > 0 ? (cost + extra) / o.qty : 0,
  });
  return { cost: cost + extra, takes, shortfall, hargaBeli };
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
