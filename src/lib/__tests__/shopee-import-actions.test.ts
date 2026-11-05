import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  user: { id: "fixture-user" } as { id: string } | null,
  role: "STAFF", active: true,
  tables: {} as Record<string, Row[]>,
  rpc: [] as { name: string; args: { p_request_key: string; p_header: Record<string, string>; p_items: Record<string, unknown>[] } }[],
  rpcImpl: null as null | ((args: { p_request_key: string; p_header: Record<string, string>; p_items: Record<string, unknown>[] }) => { data?: unknown; error?: { message: string }; throws?: boolean }),
  revalidated: [] as string[],
}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { db.revalidated.push(p); } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    rpc: async (name: string, args: never) => {
      db.rpc.push({ name, args });
      const out = db.rpcImpl ? db.rpcImpl(args) : { data: { document_id: "doc", document_no: "ONL-20261105-0001" } };
      if (out.throws) throw new Error("jaringan putus");
      return { data: out.data ?? null, error: out.error ?? null };
    },
    from(table: string) {
      if (table === "profiles") {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: db.user ? { role: db.role, is_active: db.active } : null, error: null }) };
        return q;
      }
      const filters: Record<string, unknown[]> = {};
      const rows = () => (db.tables[table] ?? []).filter(r => Object.entries(filters).every(([c, v]) => v.includes(r[c])));
      const q = {
        select: () => q,
        in(c: string, v: unknown[]) { filters[c] = v; return q; },
        eq(c: string, v: unknown) { filters[c] = [v]; return q; },
        order: () => q,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        range(from: number, to: number) { const all = rows(); return Promise.resolve({ data: all.slice(from, to + 1), count: all.length, error: null }); },
      };
      return q;
    },
  }),
}));

import { pratinjauImporShopee, simpanImporShopee } from "@/app/(app)/penjualan/online/impor/actions";

const FIXTURE = join(__dirname, "fixtures", "shopee-order-toship-sample.xlsx");
const WH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JIO = "11111111-1111-4111-8111-111111111111", DIG = "22222222-2222-4222-8222-222222222222", HAIR = "33333333-3333-4333-8333-333333333333";
const O1 = "2611050FIKTIF1", O2 = "2611050FIKTIF2", O3 = "2611050FIKTIF3";
const file = () => new File([readFileSync(FIXTURE)], "Order.toship.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
const form = (selection: unknown, extra: Record<string, string> = {}, f: File = file()) => {
  const fd = new FormData();
  fd.set("file", f); fd.set("warehouse_id", WH); fd.set("selection", JSON.stringify(selection));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
};
const SEL = [{ orderNo: O2, items: [JIO] }, { orderNo: O3, items: [DIG, HAIR] }];

beforeEach(() => {
  db.user = { id: "fixture-user" }; db.role = "STAFF"; db.active = true; db.rpc = []; db.rpcImpl = null; db.revalidated = [];
  db.tables = {
    warehouses: [{ id: WH, type: "ONLINE", is_active: true, name: "Online Fiktif" }],
    items: [
      { id: JIO, code: "JIO-500", name: "Jio Dryfood 500gr", sell_price: "16500.00", is_active: true, item_type: "Persediaan" },
      { id: DIG, code: "MRV-DIG", name: "Mr.Vet Digestion Care T1 1kg", sell_price: "80000", is_active: true, item_type: "Persediaan" },
      { id: HAIR, code: "MRV-HAIR", name: "Mr.Vet Hair & Skin Care T2 1kg", sell_price: "80000", is_active: true, item_type: "Persediaan" },
      { id: "44444444-4444-4444-8444-444444444444", code: "GRUP-1", name: "Paket Grup", sell_price: "1", is_active: true, item_type: "Grup" },
      { id: "55555555-5555-4555-8555-555555555555", code: "JASA-1", name: "Jasa Grooming", sell_price: "1", is_active: true, item_type: "Jasa" },
    ],
    stock: [{ id: "s1", warehouse_id: WH, item_id: JIO, qty: "6" }, { id: "s2", warehouse_id: "lain", item_id: JIO, qty: "99" }],
    sales: [],
  };
});

describe("pratinjauImporShopee", () => {
  it("mengembalikan pesanan, katalog barang stok aktif (+stok gudang terpilih), dan pesanan yang sudah diimpor", async () => {
    db.tables.sales = [{ id: "sale-1", channel: "Shopee", external_ref: O2, no_struk: "ONL-20261105-0007", voided_at: null }, { id: "sale-2", channel: "WA", external_ref: O3, no_struk: "ONL-X", voided_at: null }];
    const r = await pratinjauImporShopee(form([]));
    expect(r.error).toBeUndefined();
    expect(r.orders.map(o => o.orderNo)).toEqual([O1, O2, O3]);
    expect(r.catalog.map(c => c.code).sort()).toEqual(["JIO-500", "MRV-DIG", "MRV-HAIR"]);
    expect(r.catalog.find(c => c.id === JIO)).toMatchObject({ sell_price: 16500, stock: 6 });
    expect(r.catalog.find(c => c.id === DIG)?.stock).toBe(0);
    expect(r.existing).toEqual({ [O2]: { noStruk: "ONL-20261105-0007", voided: false } });
  });
  it("hasil pratinjau tidak memuat alamat/telepon/nama penerima", async () => {
    const r = await pratinjauImporShopee(form([]));
    expect(JSON.stringify(r)).not.toMatch(/DIMASKING|Jl\. Fiktif|KOTA FIKTIF|\*\*\*\*\*\*00/);
  });
  it("tanpa login / gudang tak ada / bukan xlsx / tanpa file -> pesan Indonesia", async () => {
    db.user = null;
    expect((await pratinjauImporShopee(form([]))).error).toMatch(/masuk|login|sesi/i);
    db.user = { id: "fixture-user" };
    db.tables.warehouses = [];
    expect((await pratinjauImporShopee(form([]))).error).toMatch(/gudang online/i);
    db.tables.warehouses = [{ id: WH, type: "ONLINE", is_active: true }];
    expect((await pratinjauImporShopee(form([], {}, new File(["x"], "a.csv")))).error).toMatch(/\.xlsx/);
    const fd = new FormData(); fd.set("warehouse_id", WH);
    expect((await pratinjauImporShopee(fd)).error).toMatch(/file/i);
    expect(db.rpc).toEqual([]);
  });
});

describe("simpanImporShopee", () => {
  it("satu RPC post_online_order per pesanan, kunci deterministik dari No. Pesanan + gudang, harga/qty dari file", async () => {
    const r = await simpanImporShopee(form(SEL));
    expect(r.results.map(x => [x.orderNo, x.status, x.documentNo])).toEqual([[O2, "ok", "ONL-20261105-0001"], [O3, "ok", "ONL-20261105-0001"]]);
    expect(db.rpc.map(c => c.name)).toEqual(["post_online_order", "post_online_order"]);
    expect(db.rpc[0].args).toEqual({
      p_request_key: `shopee-import:${O2}:${WH}`,
      p_header: { channel: "Shopee", warehouse_id: WH, buyer_name: "pembeli_fiktif_2", external_ref: O2, customer_id: "", tanggal: "2026-11-05" },
      p_items: [{ item_id: JIO, qty: 2, harga: 16349, satuan: "" }],
    });
    expect(db.rpc[1].args.p_items).toEqual([
      { item_id: DIG, qty: 1, harga: 78663, satuan: "" },
      { item_id: HAIR, qty: 1, harga: 78663, satuan: "" },
    ]);
    expect(db.rpc[1].args.p_request_key).toBe(`shopee-import:${O3}:${WH}`);
    expect(db.revalidated).toContain("/penjualan/online");
  });

  it("tidak menyimpan alamat/telepon/nama penerima di payload RPC", async () => {
    await simpanImporShopee(form(SEL));
    const json = JSON.stringify(db.rpc);
    expect(json).not.toMatch(/DIMASKING|Jl\. Fiktif|KOTA FIKTIF|PROVINSI|\*\*\*\*\*\*00|P\*\*\*\*\*a/);
    for (const c of db.rpc) expect(Object.keys(c.args.p_header).sort()).toEqual(["buyer_name", "channel", "customer_id", "external_ref", "tanggal", "warehouse_id"]);
  });

  it("pesanan Pembatalan diajukan tidak pernah diposting secara bawaan (juga bila dikirim dalam pilihan)", async () => {
    const r = await simpanImporShopee(form([{ orderNo: O1, items: [JIO] }, ...SEL]));
    expect(r.results[0]).toMatchObject({ orderNo: O1, status: "dilewati" });
    expect(r.results[0].message).toMatch(/Pembatalan diajukan/);
    expect(db.rpc.map(c => c.args.p_header.external_ref)).toEqual([O2, O3]);
  });
  it("menyertakan pesanan dilewati hanya boleh Owner", async () => {
    const sel = [{ orderNo: O1, items: [JIO], sertakan: true }];
    db.role = "STAFF";
    expect((await simpanImporShopee(form(sel))).results[0].status).toBe("dilewati");
    expect(db.rpc).toEqual([]);
    db.role = "OWNER";
    expect((await simpanImporShopee(form(sel))).results[0].status).toBe("ok");
    expect(db.rpc).toHaveLength(1);
  });

  it("pesanan berdata rusak (angka '1,000' tidak jelas) tidak pernah diposting, juga oleh Owner yang menyertakan; pesanan sehat di file yang sama tetap jalan", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("orders");
    ws.addRow(["No. Pesanan", "Status Pesanan", "Waktu Pesanan Dibuat", "Nama Produk", "Harga Setelah Diskon", "Jumlah", "Username (Pembeli)"]);
    ws.addRow(["RUSAK-0001", "Perlu Dikirim", "2026-11-05 10:00", "Jio Dryfood 500gr", "1,000", "1", "pembeli_fiktif"]);
    ws.addRow(["SEHAT-0001", "Perlu Dikirim", "2026-11-05 10:00", "Jio Dryfood 500gr", "16.500", "1", "pembeli_fiktif"]);
    const f = new File([Buffer.from(await wb.xlsx.writeBuffer())], "Order.toship.xlsx");
    db.role = "OWNER";
    const r = await simpanImporShopee(form([{ orderNo: "RUSAK-0001", items: [JIO], sertakan: true }, { orderNo: "SEHAT-0001", items: [JIO] }], {}, f));
    expect(r.results.map(x => [x.orderNo, x.status])).toEqual([["RUSAK-0001", "dilewati"], ["SEHAT-0001", "ok"]]);
    expect(r.results[0].message).toContain("angka tidak jelas");
    expect(db.rpc.map(c => c.args.p_header.external_ref)).toEqual(["SEHAT-0001"]);
  });
  it("pesanan yang sudah ada (external_ref) = duplikat, RPC tidak dipanggil", async () => {
    db.tables.sales = [{ id: "sale-1", channel: "Shopee", external_ref: O2, no_struk: "ONL-20261105-0007", voided_at: null }];
    const r = await simpanImporShopee(form(SEL));
    expect(r.results[0]).toMatchObject({ orderNo: O2, status: "duplikat" });
    expect(r.results[0].message).toContain("ONL-20261105-0007");
    expect(db.rpc.map(c => c.args.p_header.external_ref)).toEqual([O3]);
  });

  it("file yang sama dua kali: kedua kalinya semua 'duplikat', tanpa RPC baru", async () => {
    db.rpcImpl = ({ p_header }) => {
      db.tables.sales.push({ id: `sale-${p_header.external_ref}`, channel: "Shopee", external_ref: p_header.external_ref, no_struk: "ONL-1", voided_at: null });
      return { data: { document_id: "d", document_no: "ONL-1" } };
    };
    const first = await simpanImporShopee(form(SEL));
    expect(first.results.map(x => x.status)).toEqual(["ok", "ok"]);
    const second = await simpanImporShopee(form(SEL));
    expect(second.results.map(x => x.status)).toEqual(["duplikat", "duplikat"]);
    expect(db.rpc).toHaveLength(2);
  });

  it("coba ulang saat respons hilang memakai kunci yang sama (RPC idempoten)", async () => {
    db.rpcImpl = () => ({ throws: true });
    const a = await simpanImporShopee(form([SEL[0]]));
    expect(a.results[0].status).toBe("error");
    expect(a.results[0].message).toMatch(/belum dapat dipastikan/i);
    db.rpcImpl = null;
    await simpanImporShopee(form([SEL[0]]));
    expect(db.rpc[0].args.p_request_key).toBe(db.rpc[1].args.p_request_key);
    expect(db.rpc[0].args).toEqual(db.rpc[1].args);
  });

  it("satu pesanan gagal tidak menghentikan yang lain; galat RPC dilaporkan per pesanan", async () => {
    db.rpcImpl = ({ p_header }) => p_header.external_ref === O2 ? { error: { message: "Stok tidak cukup" } } : { data: { document_id: "d", document_no: "ONL-2" } };
    const r = await simpanImporShopee(form(SEL));
    expect(r.results[0]).toMatchObject({ orderNo: O2, status: "error", message: "Stok tidak cukup" });
    expect(r.results[1]).toMatchObject({ orderNo: O3, status: "ok", documentNo: "ONL-2" });
    expect(r.ok).toBe(false);
  });

  it("'permintaan sudah digunakan dengan rincian berbeda' dijelaskan, bukan diteruskan mentah", async () => {
    db.rpcImpl = () => ({ error: { message: "Permintaan sudah digunakan dengan rincian berbeda" } });
    const r = await simpanImporShopee(form([SEL[0]]));
    expect(r.results[0].status).toBe("error");
    expect(r.results[0].message).toMatch(/Penjualan Online/);
  });

  it("atomik per pesanan: baris belum dipetakan = seluruh pesanan ditolak, tanpa RPC (tidak ada order sebagian)", async () => {
    const r = await simpanImporShopee(form([{ orderNo: O3, items: [DIG, ""] }, { orderNo: O2, items: [] }]));
    expect(r.results.map(x => x.status)).toEqual(["error", "error"]);
    // jumlah pemetaan kurang dari jumlah baris pesanan (2 baris, 1 barang) juga ditolak utuh
    expect((await simpanImporShopee(form([{ orderNo: O3, items: [DIG] }]))).results[0].status).toBe("error");
    expect(r.results[0].message).toMatch(/belum dipetakan|barang/i);
    expect(db.rpc).toEqual([]);
  });
  it("item_id bukan UUID ditolak", async () => {
    const r = await simpanImporShopee(form([{ orderNo: O2, items: ["bukan-uuid"] }]));
    expect(r.results[0].status).toBe("error");
    expect(db.rpc).toEqual([]);
  });
  it("pesanan yang tidak ada di file ditolak", async () => {
    const r = await simpanImporShopee(form([{ orderNo: "TIDAK-ADA", items: [JIO] }]));
    expect(r.results[0]).toMatchObject({ status: "error" });
    expect(db.rpc).toEqual([]);
  });
  it("pesanan yang sama dua kali dalam satu permintaan hanya diproses sekali", async () => {
    const r = await simpanImporShopee(form([SEL[0], SEL[0]]));
    expect(db.rpc).toHaveLength(1);
    expect(r.results.map(x => x.status)).toEqual(["ok", "duplikat"]);
  });
  it("tanpa login / non-aktif / pilihan kosong atau > 50 pesanan / file bukan xlsx -> error tanpa RPC", async () => {
    db.user = null;
    expect((await simpanImporShopee(form(SEL))).error).toMatch(/masuk|sesi/i);
    db.user = { id: "u" }; db.active = false;
    expect((await simpanImporShopee(form(SEL))).error).toMatch(/aktif|akses/i);
    db.active = true;
    expect((await simpanImporShopee(form([]))).error).toMatch(/pilih/i);
    expect((await simpanImporShopee(form(Array.from({ length: 51 }, () => SEL[0])))).error).toMatch(/50/);
    expect((await simpanImporShopee(form(SEL, {}, new File(["x"], "a.csv")))).error).toMatch(/\.xlsx/);
    expect((await simpanImporShopee(form(SEL, { warehouse_id: "bukan-uuid" }))).error).toMatch(/gudang/i);
    expect((await simpanImporShopee(form("bukan-json" as never, { selection: "{rusak" }))).error).toMatch(/pilihan/i);
    expect(db.rpc).toEqual([]);
  });
});
