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

async function adjustStockQty(supabase: AnyClient, warehouseId: string, itemId: string, delta: number) {
  const { data: st } = await supabase
    .from("stock").select("qty")
    .eq("warehouse_id", warehouseId).eq("item_id", itemId).maybeSingle();
  if (st) {
    await supabase.from("stock")
      .update({ qty: Number(st.qty) + delta, updated_at: new Date().toISOString() })
      .eq("warehouse_id", warehouseId).eq("item_id", itemId);
  } else {
    await supabase.from("stock").insert({ warehouse_id: warehouseId, item_id: itemId, qty: delta });
  }
}

export type StockInOpts = {
  warehouseId: string; itemId: string; qty: number; unitCost: number;
  source: string; ref?: string | null; tanggal?: string;
};

// Stok masuk: buat layer baru + naikkan qty.
export async function stockIn(supabase: AnyClient, o: StockInOpts): Promise<void> {
  if (o.qty <= 0) return;
  await supabase.from("stock_layers").insert({
    warehouse_id: o.warehouseId, item_id: o.itemId,
    tanggal: o.tanggal ?? new Date().toISOString().slice(0, 10),
    qty_in: o.qty, qty_left: o.qty, unit_cost: o.unitCost,
    source: o.source, source_ref: o.ref ?? null,
  });
  await adjustStockQty(supabase, o.warehouseId, o.itemId, o.qty);
}

export type StockOutOpts = {
  warehouseId: string; itemId: string; qty: number;
  source: string; ref?: string | null;
};

// Stok keluar: konsumsi layer FIFO, turunkan qty, kembalikan total cost (HPP riil).
// Shortfall (layer tidak cukup) dihargai items.buy_price — tidak membuat layer negatif.
export async function stockOut(supabase: AnyClient, o: StockOutOpts): Promise<{ cost: number }> {
  if (o.qty <= 0) return { cost: 0 };

  const { data: layersRaw } = await supabase
    .from("stock_layers")
    .select("id, qty_left, unit_cost")
    .eq("warehouse_id", o.warehouseId).eq("item_id", o.itemId)
    .gt("qty_left", 0)
    .order("tanggal", { ascending: true })
    .order("created_at", { ascending: true });

  const { takes, cost, shortfall } = consumeLayers((layersRaw ?? []) as Layer[], o.qty);

  for (const t of takes) {
    const layer = (layersRaw ?? []).find((l: Layer) => l.id === t.id);
    await supabase.from("stock_layers")
      .update({ qty_left: Number(layer?.qty_left ?? 0) - t.qty })
      .eq("id", t.id);
  }

  let extra = 0;
  if (shortfall > 0) {
    const { data: item } = await supabase.from("items").select("buy_price").eq("id", o.itemId).maybeSingle();
    extra = shortfall * (Number(item?.buy_price) || 0);
  }

  await adjustStockQty(supabase, o.warehouseId, o.itemId, -o.qty);
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
