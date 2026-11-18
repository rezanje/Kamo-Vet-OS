import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Aksi impor Shopee untuk peran Admin Online: semua bacaan lewat RPC (database menutup tabelnya), hasilnya HARUS sama dengan jalur tabel peran lain.
type Row = Record<string, unknown>;
type RpcCall = { name: string; args: Record<string, unknown> };
const db = vi.hoisted(() => ({
  user: { id: "fixture-user" } as { id: string } | null,
  role: "STAFF", active: true,
  tables: {} as Record<string, Row[]>,
  rpc: [] as { name: string; args: Record<string, unknown> }[],
  tableReads: [] as string[],
  allowed: null as string[] | null,
  postImpl: null as null | ((args: Record<string, unknown>) => { data?: unknown; error?: { message: string } }),
}));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => db.allowed }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

/** Simulasi RPC database (bentuk jawaban = migrasi 20261126100100) dari data meja yang sama dengan jalur tabel. */
function rpcDb(name: string, a: Record<string, unknown>): { data?: unknown; error?: { message: string } } {
  const t = db.tables;
  if (name === "admin_online_import_gudang") {
    return { data: (t.warehouses ?? []).filter(w => w.is_active && ["ONLINE", "RETAIL"].includes(String(w.type)) && (db.allowed === null || db.allowed.includes(String(w.branch_id))))
      .map(w => ({ id: w.id, name: w.name, branch_id: w.branch_id, type: w.type, branch_name: (w.branches as { name: string }).name })) };
  }
  if (name === "admin_online_import_catalog") {
    const wh = (t.warehouses ?? []).find(w => w.id === a.p_warehouse);
    if (!wh) return { error: { message: "ADMIN_ONLINE_GATE_WAREHOUSE: gudang tidak dapat dipakai akun ini" } };
    const aktif = (t.items ?? []).filter(i => i.is_active && (!i.item_type || ["Persediaan", "Grup"].includes(String(i.item_type))));
    return { data: {
      items: aktif.map(i => ({ id: i.id, code: i.code, name: i.name, unit: i.unit ?? null, sell_price: i.sell_price, item_type: i.item_type })),
      stock: (t.stock ?? []).filter(s => s.warehouse_id === wh.id).map(s => ({ item_id: s.item_id, qty: s.qty })),
      units: (t.item_units ?? []).map(u => ({ item_id: u.item_id, unit: u.unit, factor: u.factor, sell_price: u.sell_price })),
      group_components: (t.item_group_components ?? []).map(g => { const c = g.component as Row; return { group_item_id: g.group_item_id, component_item_id: g.component_item_id, qty: g.qty, unit: g.unit, factor: g.factor, code: c.code, name: c.name, item_type: c.item_type, is_active: c.is_active }; }),
    } };
  }
  if (name === "admin_online_import_existing") {
    const refs = a.p_refs as string[];
    return { data: (t.sales ?? []).filter(s => s.channel === "Shopee" && refs.includes(String(s.external_ref))).map(s => ({ external_ref: s.external_ref, no_struk: s.no_struk, voided: !!s.voided_at })) };
  }
  if (name === "post_online_order") return db.postImpl ? db.postImpl(a) : { data: { document_id: "doc", document_no: "ONL-20261105-0001" } };
  return { error: { message: `rpc tak dikenal: ${name}` } };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.rpc.push({ name, args });
      const out = rpcDb(name, args);
      return { data: out.data ?? null, error: out.error ?? null };
    },
    from(table: string) {
      if (table === "profiles") {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: db.user ? { role: db.role, is_active: db.active } : null, error: null }) };
        return q;
      }
      db.tableReads.push(table);
      // Admin Online: pagar baca database menolak semua tabel selain profil sendiri (hak tabel dicabut oleh RLS -> 0 baris/galat).
      if (db.role === "ADMIN_ONLINE") throw new Error(`pagar baca: tabel ${table} tertutup untuk Admin Online`);
      const filters: Record<string, unknown[]> = {};
      const rows = () => (db.tables[table] ?? []).filter(r => Object.entries(filters).every(([c, v]) => v.includes(r[c])));
      const q = {
        select: () => q,
        in(c: string, v: unknown[]) { filters[c] = v; return q; },
        eq(c: string, v: unknown) { filters[c] = [v]; return q; },
        order: () => q,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
        range(from: number, to: number) { const all = rows(); return Promise.resolve({ data: all.slice(from, to + 1), count: all.length, error: null }); },
      };
      return q;
    },
  }),
}));

import { pratinjauImporShopee, simpanImporShopee } from "@/app/(app)/penjualan/online/impor/actions";
import { parseGudangAdminOnline, parseKatalogAdminOnline, parseSudahAdaAdminOnline } from "@/lib/admin-online-impor";

const FIXTURE = join(__dirname, "fixtures", "shopee-order-toship-sample.xlsx");
const WH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", WH_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", BR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", BR_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const gudang = (over: Row = {}) => ({ id: WH, branch_id: BR, type: "ONLINE", is_active: true, name: "Online Fiktif", branches: { name: "Cabang Fiktif" }, ...over });
const JIO = "11111111-1111-4111-8111-111111111111", DIG = "22222222-2222-4222-8222-222222222222", HAIR = "33333333-3333-4333-8333-333333333333";
const GRUP = "44444444-4444-4444-8444-444444444444", JASA = "55555555-5555-4555-8555-555555555555";
const O1 = "2611050FIKTIF1", O2 = "2611050FIKTIF2", O3 = "2611050FIKTIF3";
const file = () => new File([readFileSync(FIXTURE)], "Order.toship.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
const form = (selection: unknown, extra: Record<string, string> = {}, branch = BR) => {
  const fd = new FormData();
  fd.set("file", file()); fd.set("branch_id", branch); fd.set("selection", JSON.stringify(selection));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
};
const SEL = [{ orderNo: O2, items: [JIO] }, { orderNo: O3, items: [DIG, HAIR] }];
const rpcNames = () => db.rpc.map((c: RpcCall) => c.name);

beforeEach(() => {
  db.user = { id: "fixture-user" }; db.role = "STAFF"; db.active = true; db.rpc = []; db.tableReads = []; db.allowed = null; db.postImpl = null;
  db.tables = {
    warehouses: [gudang(), gudang({ id: WH_B, branch_id: BR_B, name: "Online B", branches: { name: "Cabang B" } })],
    items: [
      { id: JIO, code: "JIO-500", name: "Jio Dryfood 500gr", unit: "1/2kg", sell_price: "16500.00", is_active: true, item_type: "Persediaan", buy_price: "9000" },
      { id: DIG, code: "MRV-DIG", name: "Mr.Vet Digestion Care T1 1kg", sell_price: "80000", is_active: true, item_type: "Persediaan", buy_price: "50000" },
      { id: HAIR, code: "MRV-HAIR", name: "Mr.Vet Hair & Skin Care T2 1kg", sell_price: "80000", is_active: true, item_type: "Persediaan", buy_price: "50000" },
      { id: GRUP, code: "GRUP-1", name: "Paket Grup", sell_price: "1", is_active: true, item_type: "Grup" },
      { id: JASA, code: "JASA-1", name: "Jasa Grooming", sell_price: "1", is_active: true, item_type: "Jasa" },
    ],
    stock: [{ id: "s1", warehouse_id: WH, item_id: JIO, qty: "6" }, { id: "s2", warehouse_id: WH_B, item_id: JIO, qty: "99" }],
    sales: [{ id: "sale-1", channel: "Shopee", external_ref: O2, no_struk: "ONL-20261105-0007", voided_at: null }, { id: "sale-2", channel: "WA", external_ref: O3, no_struk: "ONL-X", voided_at: null }],
    item_units: [{ item_id: JIO, unit: "1kg", factor: "2", sell_price: "31000", buy_price: "25000" }],
    item_group_components: [
      { id: "c1", group_item_id: GRUP, component_item_id: JIO, qty: "2", unit: "1kg", factor: "2", sort_order: 0, component: { id: JIO, code: "JIO-500", name: "Jio Dryfood 500gr", item_type: "Persediaan", is_active: true } },
    ],
  };
});

describe("Admin Online: pratinjau lewat RPC, hasil sama dengan jalur tabel peran lain", () => {
  it("tidak membaca tabel apa pun selain profil sendiri; hanya RPC khusus", async () => {
    db.role = "ADMIN_ONLINE";
    const r = await pratinjauImporShopee(form([]));
    expect(r.error).toBeUndefined();
    expect(db.tableReads).toEqual([]);
    expect(rpcNames()).toEqual(["admin_online_import_gudang", "admin_online_import_catalog", "admin_online_import_existing"]);
    expect(db.rpc[1].args).toEqual({ p_warehouse: WH });
    expect(db.rpc[2].args).toEqual({ p_refs: [O1, O2, O3] });
    expect(JSON.stringify(r.catalog)).not.toMatch(/buy_price/);
  });
  it("katalog, stok, satuan, isi paket, dan pesanan sudah-diimpor IDENTIK dengan jalur tabel (STAFF)", async () => {
    const staff = await pratinjauImporShopee(form([]));
    expect(rpcNames()).toEqual([]);                       // peran lain: tidak memanggil RPC khusus
    expect(db.tableReads.length).toBeGreaterThan(0);
    db.role = "ADMIN_ONLINE"; db.rpc = []; db.tableReads = [];
    const ao = await pratinjauImporShopee(form([]));
    expect(ao).toEqual(staff);
    expect(ao.catalog.find(c => c.id === JIO)).toMatchObject({ sell_price: 16500, stock: 6 });
    expect(ao.catalog.find(c => c.id === GRUP)?.grup).toEqual([{ id: JIO, code: "JIO-500", name: "Jio Dryfood 500gr", unit: "1/2kg", qtyDasar: 4, item_type: "Persediaan", stock: 6 }]);
    expect(ao.existing).toEqual({ [O2]: { noStruk: "ONL-20261105-0007", voided: false } });
    expect(ao.catalog.map(c => c.code)).not.toContain("JASA-1");
  });
  it("cabang lain / gudang yang tidak diizinkan: ditolak sebelum membaca katalog", async () => {
    db.role = "ADMIN_ONLINE"; db.allowed = [BR];
    // Satu cabang: terkunci ke cabang akun sendiri; cabang kiriman klien diabaikan (tidak pernah memakai gudang cabang lain).
    const kunci = await pratinjauImporShopee(form([], {}, BR_B));
    expect(kunci.error).toBeUndefined();
    expect(db.rpc.find(c => c.name === "admin_online_import_catalog")?.args).toEqual({ p_warehouse: WH });
    // Dua cabang diizinkan, klien meminta cabang ketiga: ditolak sebelum katalog dibaca.
    db.rpc = []; db.allowed = [BR, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"];
    db.tables.warehouses.push(gudang({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", branch_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", branches: { name: "Cabang E" } }));
    const r = await pratinjauImporShopee(form([], {}, BR_B));
    expect(r.error).toMatch(/Pilih cabang/);
    expect(rpcNames()).not.toContain("admin_online_import_catalog");
    db.rpc = []; db.allowed = [BR];
    db.tables.warehouses = [gudang(), gudang({ id: WH_B, branch_id: BR_B, name: "Online B", branches: { name: "Cabang B" } })];
    db.tables.warehouses = [gudang({ type: "VET" })];
    expect((await pratinjauImporShopee(form([]))).error).toMatch(/belum terhubung ke cabang/i);      // gudang Klinik tidak ditawarkan
    db.tables.warehouses = [gudang({ type: "RETAIL" })];
    expect((await pratinjauImporShopee(form([]))).error ?? "").not.toMatch(/gudang|cabang/i);        // Toko/Petshop = gudang utama cabang (E4)
  });
  it("akun nonaktif / tanpa sesi ditolak sebelum RPC apa pun", async () => {
    db.role = "ADMIN_ONLINE"; db.active = false;
    expect((await pratinjauImporShopee(form([]))).error).toMatch(/tidak aktif/i);
    db.active = true; db.user = null;
    expect((await pratinjauImporShopee(form([]))).error).toMatch(/masuk|sesi/i);
    expect(db.rpc).toEqual([]);
  });
});

describe("Admin Online: simpan memakai post_online_order saja (gerbang database menentukan)", () => {
  it("header & baris persis seperti jalur lain (tanpa pelanggan); duplikat dibaca lewat RPC dan dilewati", async () => {
    db.role = "ADMIN_ONLINE";
    const r = await simpanImporShopee(form(SEL));
    expect(db.tableReads).toEqual([]);
    expect(r.results.map(x => [x.orderNo, x.status])).toEqual([[O2, "duplikat"], [O3, "ok"]]);
    const post = db.rpc.filter(c => c.name === "post_online_order");
    expect(post).toHaveLength(1);
    expect(post[0].args).toEqual({
      p_request_key: `shopee-import:${O3}:${WH}`,
      p_header: { channel: "Shopee", warehouse_id: WH, buyer_name: "pembeli_fiktif_3", external_ref: O3, customer_id: "", tanggal: "2026-11-05" },
      p_items: [{ item_id: DIG, qty: 1, harga: 78663, satuan: "" }, { item_id: HAIR, qty: 1, harga: 78663, satuan: "" }],
    });
    // kolom yang dikirim = tepat yang diizinkan gerbang database (kunci lain akan ditolak ADMIN_ONLINE_GATE_HEADER/ITEMS)
    expect(Object.keys(post[0].args.p_header as object).sort()).toEqual(["buyer_name", "channel", "customer_id", "external_ref", "tanggal", "warehouse_id"]);
    for (const it of post[0].args.p_items as object[]) expect(Object.keys(it).sort()).toEqual(["harga", "item_id", "qty", "satuan"]);
  });
  it("hanya Owner boleh menyertakan pesanan yang dilewati; Admin Online tidak", async () => {
    db.role = "ADMIN_ONLINE";
    const r = await simpanImporShopee(form([{ orderNo: O1, items: [JIO], sertakan: true }]));
    expect(r.results[0].status).toBe("dilewati");
    expect(db.rpc.filter(c => c.name === "post_online_order")).toHaveLength(0);
  });
  it("penolakan gerbang database disampaikan apa adanya (tidak ada simpan sebagian)", async () => {
    db.role = "ADMIN_ONLINE";
    db.postImpl = () => ({ error: { message: "ADMIN_ONLINE_GATE_BRANCH: cabang tidak ada dalam penugasan akun ini" } });
    const r = await simpanImporShopee(form([{ orderNo: O3, items: [DIG, HAIR] }]));
    expect(r.ok).toBe(false);
    expect(r.results[0]).toMatchObject({ status: "error" });
    expect(r.results[0].message).toMatch(/penugasan akun/);
  });
  it("peran lain tetap jalur lama: tidak memanggil RPC khusus Admin Online", async () => {
    await simpanImporShopee(form([{ orderNo: O3, items: [DIG, HAIR] }]));
    expect(rpcNames()).toEqual(["post_online_order"]);
  });
});

describe("pembaca bentuk jawaban RPC (gagal tertutup untuk data aneh)", () => {
  it("gudang: hanya ONLINE/RETAIL berbaris lengkap", () => {
    expect(parseGudangAdminOnline([{ id: "a", name: "x", branch_id: "b", type: "ONLINE", branch_name: "C" }, { id: "a2", name: "x", branch_id: "b", type: "VET", branch_name: "C" },
      { id: "", name: "x", branch_id: "b", type: "RETAIL" }, "x", null])).toEqual([{ id: "a", name: "x", branch_id: "b", type: "ONLINE", branch_name: "C" }]);
    expect(parseGudangAdminOnline(null)).toEqual([]);
    expect(parseGudangAdminOnline({ id: "a" })).toEqual([]);
  });
  it("katalog: tanpa harga beli; satuan buy_price 0; kosong/aneh -> daftar kosong", () => {
    const k = parseKatalogAdminOnline({ items: [{ id: "i", code: "C", name: "N", unit: "pcs", sell_price: "5", item_type: "Persediaan", buy_price: 99 }], stock: [{ item_id: "i", qty: "3" }],
      units: [{ item_id: "i", unit: "dus", factor: "6", sell_price: "30", buy_price: 77 }], group_components: [] });
    expect(k.items).toEqual([{ id: "i", code: "C", name: "N", unit: "pcs", sell_price: 5, item_type: "Persediaan" }]);
    expect(k.stock).toEqual([{ item_id: "i", qty: 3 }]);
    expect(k.extraUnits.get("i")).toEqual([{ unit: "dus", factor: 6, sell_price: 30, buy_price: 0 }]);
    expect(JSON.stringify(k)).not.toMatch(/99|77/);
    expect(parseKatalogAdminOnline("x")).toEqual({ items: [], stock: [], extraUnits: new Map(), resep: [] });
  });
  it("sudah-diimpor: pesanan aktif didahulukan dari yang dibatalkan", () => {
    expect(parseSudahAdaAdminOnline([{ external_ref: "R", no_struk: "A", voided: true }, { external_ref: "R", no_struk: "B", voided: false }, { external_ref: "", no_struk: "Z" }]))
      .toEqual({ R: { noStruk: "B", voided: false } });
  });
});
