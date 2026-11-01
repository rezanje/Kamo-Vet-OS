import { describe, expect, it } from "vitest";
import { ambilPelangganKasir, cariPelangganKasir, cocokPelanggan, polaHpPelanggan } from "../kasir-pelanggan";

type Ops = [string, unknown[]][];
type Row = Record<string, unknown>;

/** Klien palsu: mencatat filter tiap query dan menjawab dari fixture, tanpa database. */
function fakeDb(tables: Record<string, Row[]>) {
  const calls: { table: string; ops: Ops }[] = [];
  const from = (table: string) => {
    const ops: Ops = [];
    calls.push({ table, ops });
    const answer = () => {
      let rows = [...(tables[table] ?? [])];
      for (const [op, args] of ops) {
        if (op === "ilike") {
          const needle = String(args[1]).slice(1, -1).replace(/\\(.)/g, "$1").toLowerCase();
          rows = rows.filter(r => String(r[args[0] as string]).toLowerCase().includes(needle));
        }
        if (op === "filter" && args[1] === "match") rows = rows.filter(r => new RegExp(String(args[2])).test(String(r[args[0] as string])));
        if (op === "eq" && args[0] === "id") rows = rows.filter(r => r.id === args[1]);
        if (op === "in" && args[0] === "customer_id") rows = rows.filter(r => (args[1] as string[]).includes(r.customer_id as string));
        if (op === "in" && args[0] === "visits.customer_id") rows = rows.filter(r => (args[1] as string[]).includes((r.visits as Row).customer_id as string));
        if (op === "limit") rows = rows.slice(0, args[0] as number);
      }
      const single = ops.some(([op]) => op === "maybeSingle");
      return { data: single ? (rows[0] ?? null) : rows, error: null };
    };
    const builder: Record<string, unknown> = {};
    for (const op of ["select", "ilike", "filter", "order", "limit", "eq", "in", "is", "maybeSingle"]) {
      builder[op] = (...args: unknown[]) => { ops.push([op, args]); return builder; };
    }
    builder.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, bad);
    return builder;
  };
  return { db: { from } as never, calls };
}

const cust = (id: string, name: string, phone: string, extra: Row = {}): Row => ({
  id, name, phone, points: 0, tier: null, kategori: "Umum", category_id: null,
  customer_categories: null, customer_review_statuses: null, ...extra,
});

describe("cocokPelanggan & polaHpPelanggan", () => {
  it("cocok nama tanpa beda huruf besar dan nomor HP lokal/internasional", () => {
    expect(cocokPelanggan({ name: "Budi Santoso", phone: "0811" }, "SANTO")).toBe(true);
    expect(cocokPelanggan({ name: "X", phone: "+62 858-9876-5432" }, "0858")).toBe(true);
    expect(cocokPelanggan({ name: "X", phone: "085898765432" }, "+62 858")).toBe(true);
    expect(cocokPelanggan({ name: "X", phone: "0811" }, "   ")).toBe(false);
  });

  it("pola HP database menembus pemisah nomor dan awalan +62", () => {
    const pola = new RegExp(polaHpPelanggan("0812-1002")!);
    expect(pola.test("0812-1002-7879")).toBe(true);
    expect(pola.test("+62 812 1002 7879")).toBe(true);
    expect(pola.test("081299999999")).toBe(false);
    expect(polaHpPelanggan("Budi")).toBeNull();
  });
});

describe("cariPelangganKasir", () => {
  it("hanya meminta baris yang cocok (dibatasi) — tidak membaca seluruh pelanggan", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => cust(`c${String(i).padStart(2, "0")}`, `Budi ${String(i).padStart(2, "0")}`, `0812000000${i}`));
    const { db, calls } = fakeDb({ customers: rows, sales: [], invoices: [] });
    const hasil = await cariPelangganKasir(db, "budi");
    expect(hasil.map(r => r.name)).toEqual(["Budi 00", "Budi 01", "Budi 02", "Budi 03", "Budi 04"]);
    const kueriPelanggan = calls.filter(c => c.table === "customers");
    expect(kueriPelanggan.length).toBeGreaterThan(0);
    for (const c of kueriPelanggan) expect(c.ops.some(([op]) => op === "limit")).toBe(true);
    expect(kueriPelanggan.some(c => c.ops.some(([op]) => op === "range"))).toBe(false);
  });

  it("menggabungkan hasil nama & HP tanpa dobel, urut nama", async () => {
    const { db } = fakeDb({
      customers: [cust("a", "Zaki 0858", "0858111"), cust("b", "Ani", "+62 858-1234"), cust("c", "Lain", "0811")],
      sales: [], invoices: [],
    });
    expect((await cariPelangganKasir(db, "0858")).map(r => r.id)).toEqual(["b", "a"]);
  });

  it("menghitung ringkasan transaksi & golongan hanya untuk pelanggan hasil", async () => {
    const { db, calls } = fakeDb({
      customers: [cust("a", "Ani", "0811", {
        category_id: "gold",
        customer_categories: { nama: "Gold", diskon_persen: 5, rupiah_per_poin: 1000, is_active: true },
        customer_review_statuses: { nama: "Bintang 5", warna: "#0a0", nada: "positif" },
      })],
      sales: [
        { customer_id: "a", total: 10000, payment_plan: null, payments_finalized_at: null, voided_at: null },
        { customer_id: "a", total: 99999, payment_plan: null, payments_finalized_at: null, voided_at: "2026-11-01" },
        { customer_id: "b", total: 5000, payment_plan: null, payments_finalized_at: null, voided_at: null },
        // Pembayaran bertahap yang belum final bukan transaksi selesai.
        { customer_id: "a", total: 77777, payment_plan: [{ method: "Tunai", amount: 77777 }], payments_finalized_at: null, voided_at: null },
      ],
      invoices: [{ total: 20000, visits: { customer_id: "a" } }],
    });
    const [ani] = await cariPelangganKasir(db, "ani");
    expect(ani).toMatchObject({ trx: 2, belanja: 30000, kategori: "Gold", diskonPersen: 5, rupiahPerPoin: 1000, golonganId: "gold" });
    expect(ani.ulasan?.nama).toBe("Bintang 5");
    const sales = calls.find(c => c.table === "sales")!;
    expect(sales.ops).toContainEqual(["in", ["customer_id", ["a"]]]);
  });

  it("ketikan kosong tidak memanggil database", async () => {
    const { db, calls } = fakeDb({ customers: [] });
    expect(await cariPelangganKasir(db, "   ")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("karakter % dan _ dari kasir dibaca apa adanya", async () => {
    const { db, calls } = fakeDb({ customers: [cust("a", "100% Kucing", "0811")], sales: [], invoices: [] });
    await cariPelangganKasir(db, "100%");
    const nama = calls.find(c => c.ops.some(([op]) => op === "ilike"))!;
    expect(nama.ops.find(([op]) => op === "ilike")![1][1]).toBe("%100\\%%");
  });
});

describe("ambilPelangganKasir", () => {
  it("memuat satu pelanggan lengkap untuk pemulihan draf", async () => {
    const { db } = fakeDb({ customers: [cust("a", "Ani", "0811", { points: 15 })], sales: [], invoices: [] });
    expect(await ambilPelangganKasir(db, "a")).toMatchObject({ id: "a", points: 15, trx: 0 });
    expect(await ambilPelangganKasir(db, "x")).toBeNull();
  });
});

describe("cariPelangganPos", () => {
  it("golongan nonaktif tidak memberi diskon; hewan ikut terbawa", async () => {
    const { cariPelangganPos } = await import("../pos-pelanggan");
    const { db } = fakeDb({ customers: [
      cust("a", "Member Aktif", "08123", { category_id: "member", pets: [{ id: "p", name: "Mochi", species: "Kucing" }],
        customer_categories: [{ nama: "Member", diskon_persen: 10, rupiah_per_poin: 500, is_active: true }] }),
      cust("b", "Member Lama", "08456", { category_id: "old", pets: [],
        customer_categories: { nama: "Old", diskon_persen: 80, rupiah_per_poin: 5, is_active: false } }),
    ] });
    expect(await cariPelangganPos(db, "member")).toMatchObject([
      { id: "a", golonganId: "member", golongan: { diskon_persen: 10, rupiah_per_poin: 500 }, pets: [{ name: "Mochi" }] },
      { id: "b", golonganId: null, golongan: null },
    ]);
  });
});
