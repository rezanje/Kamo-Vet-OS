// Inventori FIFO — SATU pintu untuk semua mutasi stok (PRD §10.2).
// consumeLayers = pure (dites); stockIn/stockOut/transfer = wrapper supabase.
// ponytail: mutasi JS read-then-update mengikuti pola existing repo; kalau race
// jadi masalah nyata di produksi, pindahkan ke RPC Postgres satu transaksi.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type Layer = { id: string; qty_left: number; unit_cost: number };
export type Consumption = {
  takes: { id: string; qty: number; unit_cost: number }[];
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
    takes.push({ id: l.id, qty: ambil, unit_cost: Number(l.unit_cost) });
    cost += ambil * Number(l.unit_cost);
    sisa -= ambil;
  }
  return { takes, cost, shortfall: Math.max(0, sisa) };
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
    tanggal: o.tanggal ?? new Date().toISOString().slice(0, 10),
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

// Stok masuk: buat layer baru + naikkan qty.
export async function stockIn(supabase: AnyClient, o: StockInOpts): Promise<void> {
  if (o.qty <= 0) return;
  if (!(await punyaStok(supabase, o.itemId))) return;
  const { error } = await supabase.from("stock_layers").insert({
    warehouse_id: o.warehouseId, item_id: o.itemId,
    tanggal: o.tanggal ?? new Date().toISOString().slice(0, 10),
    qty_in: o.qty, qty_left: o.qty, unit_cost: o.unitCost,
    source: o.source, source_ref: o.ref ?? null,
    exp_date: o.expDate || null,
  });
  orThrow(error, "catat lapisan stok masuk");
  await adjustStockQty(supabase, o.warehouseId, o.itemId, o.qty);
  await catatMutasi(supabase, { ...o, qty: o.qty });
}

export type StockOutOpts = {
  warehouseId: string; itemId: string; qty: number;
  source: string; ref?: string | null;
};

// Stok keluar: konsumsi layer FIFO, turunkan qty, kembalikan total cost (HPP riil).
// Shortfall (layer tidak cukup) dihargai items.buy_price — tidak membuat layer negatif.
export async function stockOut(supabase: AnyClient, o: StockOutOpts): Promise<{ cost: number }> {
  if (o.qty <= 0) return { cost: 0 };
  // Jasa tidak mengurangi stok DAN tidak punya HPP persediaan — cost 0, bukan error.
  if (!(await punyaStok(supabase, o.itemId))) return { cost: 0 };

  const { data: layersRaw, error: layerErr } = await supabase
    .from("stock_layers")
    .select("id, qty_left, unit_cost")
    .eq("warehouse_id", o.warehouseId).eq("item_id", o.itemId)
    .gt("qty_left", 0)
    .order("tanggal", { ascending: true })
    .order("created_at", { ascending: true });
  orThrow(layerErr, "baca lapisan stok");

  const { takes, cost, shortfall } = consumeLayers((layersRaw ?? []) as Layer[], o.qty);

  for (const t of takes) {
    const layer = (layersRaw ?? []).find((l: Layer) => l.id === t.id);
    const { error } = await supabase.from("stock_layers")
      .update({ qty_left: Number(layer?.qty_left ?? 0) - t.qty })
      .eq("id", t.id);
    orThrow(error, "kurangi lapisan stok");
  }

  let extra = 0;
  if (shortfall > 0) {
    const { data: item } = await supabase.from("items").select("buy_price").eq("id", o.itemId).maybeSingle();
    extra = shortfall * (Number(item?.buy_price) || 0);
  }

  await adjustStockQty(supabase, o.warehouseId, o.itemId, -o.qty);
  await catatMutasi(supabase, {
    ...o, qty: -o.qty,
    unitCost: o.qty > 0 ? (cost + extra) / o.qty : 0,
  });
  return { cost: cost + extra };
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

// Pindah gudang: cost FIFO ikut barang (keluar asal → masuk tujuan dgn cost rata konsumsi).
export async function transferStock(
  supabase: AnyClient,
  o: { fromWarehouseId: string; toWarehouseId: string; itemId: string; qty: number; source: string; ref?: string | null; tanggal?: string },
): Promise<void> {
  if (o.qty <= 0) return;
  const { cost } = await stockOut(supabase, {
    warehouseId: o.fromWarehouseId, itemId: o.itemId, qty: o.qty, source: o.source, ref: o.ref,
  });
  await stockIn(supabase, {
    warehouseId: o.toWarehouseId, itemId: o.itemId, qty: o.qty,
    unitCost: o.qty > 0 ? cost / o.qty : 0,
    source: o.source, ref: o.ref, tanggal: o.tanggal,
  });
}
