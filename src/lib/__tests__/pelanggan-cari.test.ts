import { describe, expect, it, vi } from "vitest";
import { bersihkanKueriPelanggan, filterCariPelanggan } from "@/lib/pelanggan-cari";
import { cocokFilterPelanggan } from "@/components/__tests__/pelanggan-fake-api";
import { cariPelangganDb, muatPelangganKasir, muatPelangganPos } from "@/lib/pelanggan-server";

const cocok = (q: string, row: { name: string; phone: string }) => {
  const filter = filterCariPelanggan(q);
  return !!filter && cocokFilterPelanggan(filter, row);
};

describe("filterCariPelanggan", () => {
  it("menolak ketikan kurang dari 2 karakter", () => {
    expect(filterCariPelanggan("")).toBeNull();
    expect(filterCariPelanggan(" a ")).toBeNull();
    expect(filterCariPelanggan("%%")).toBeNull();
  });

  it("mencari nama tanpa peka huruf besar dan membuang karakter filter berbahaya", () => {
    expect(bersihkanKueriPelanggan("a,b(c)%_*\"\\")).toBe("a b c");
    expect(filterCariPelanggan("yay,an")).not.toContain(",an");
    expect(cocok("yayan", { name: "Bu YAYAN", phone: "0811" })).toBe(true);
    expect(cocok("Bp. Andi", { name: "Bp. Andi Wijaya", phone: "0811" })).toBe(true);
    expect(cocok("D'Souza", { name: "Maria D'Souza", phone: "0811" })).toBe(true);
    expect(cocok("budi", { name: "Andi", phone: "0811" })).toBe(false);
  });

  it("mencocokkan nomor HP walau ditulis dengan tanda hubung, spasi, atau awalan 62", () => {
    const dash = { name: "Yayan", phone: "0812-1002-7879" };
    expect(cocok("081210027879", dash)).toBe(true);
    expect(cocok("6281210027879", dash)).toBe(true);
    expect(cocok("+62 812 1002", dash)).toBe(true);
    const intl = { name: "Internasional", phone: "+62 858-9876-5432" };
    expect(cocok("0858", intl)).toBe(true);
    expect(cocok("08589876", intl)).toBe(true);
    expect(cocok("0858", { name: "Lokal", phone: "085812345678" })).toBe(true);
    // Potongan nomor di tengah yang kebetulan diawali 62 tetap ketemu.
    expect(cocok("62789", { name: "Akhiran", phone: "081234562789" })).toBe(true);
    expect(cocok("0899", { name: "Lain", phone: "081234562789" })).toBe(false);
  });

  it("tidak mengubah nama yang mengandung angka menjadi pencarian nomor saja", () => {
    expect(cocok("Pelanggan 62", { name: "Pelanggan 62", phone: "081111234567" })).toBe(true);
  });
});

function fakeDb(tables: Record<string, Record<string, unknown>[] | Record<string, unknown> | null>, calls: string[] = []) {
  return {
    from(table: string) {
      const filters: string[] = [];
      const query = {
        select: () => query, order: () => query, is: () => query,
        or: (f: string) => { filters.push(`or:${f}`); return query; },
        eq: (k: string, v: unknown) => { filters.push(`${k}=${v}`); return query; },
        limit: (n: number) => { filters.push(`limit=${n}`); return query; },
        maybeSingle: async () => ({ data: tables[table], error: null }),
        then: (resolve: (v: unknown) => unknown) => { calls.push(`${table}:${filters.join("&")}`); return Promise.resolve({ data: tables[table], error: null }).then(resolve); },
      };
      return query;
    },
  } as never;
}

describe("pelanggan-server", () => {
  it("mencari dengan batas kecil, tidak memuat seluruh tabel", async () => {
    const calls: string[] = [];
    const rows = [{ id: "a", name: "Yayan", phone: "0812" }];
    expect(await cariPelangganDb(fakeDb({ customers: rows }, calls), "yay")).toEqual(rows);
    expect(calls[0]).toMatch(/^customers:or:name\.ilike\."\*yay\*"&limit=8$/);
    expect(await cariPelangganDb(fakeDb({ customers: rows }), "y")).toEqual([]);
  });

  it("menghitung ringkasan transaksi kasir hanya dari penjualan selesai milik pelanggan itu", async () => {
    const calls: string[] = [];
    const db = fakeDb({
      customers: { id: "c1", name: "Yayan", phone: "0812", points: 12, tier: "Gold", kategori: "Lama", category_id: "gol",
        customer_categories: { nama: "Member", diskon_persen: 10, rupiah_per_poin: 500, is_active: true }, customer_review_statuses: null },
      sales: [
        { total: 100, payment_plan: null, payments_finalized_at: null, voided_at: null },
        { total: 999, payment_plan: null, payments_finalized_at: null, voided_at: "2026-11-01" },
        { total: 50, payment_plan: "split", payments_finalized_at: null, voided_at: null },
      ],
      invoices: [{ total: 300 }],
    }, calls);
    const row = await muatPelangganKasir(db, "c1");
    expect(row).toMatchObject({ id: "c1", trx: 2, belanja: 400, kategori: "Member", diskonPersen: 10, rupiahPerPoin: 500, golonganId: "gol", points: 12 });
    expect(calls).toContain("sales:customer_id=c1");
    expect(calls).toContain("invoices:visits.customer_id=c1&paid_status=Lunas");
  });

  it("golongan nonaktif tidak memberi diskon di kasir maupun POS", async () => {
    const cust = { id: "c2", name: "Lama", phone: "0813", points: 0, tier: null, kategori: "Lama", category_id: "old",
      customer_categories: [{ nama: "Old", diskon_persen: 80, rupiah_per_poin: 5, is_active: false }], customer_review_statuses: null, pets: [{ id: "p", name: "Mochi", species: "Kucing" }] };
    expect(await muatPelangganKasir(fakeDb({ customers: cust, sales: [], invoices: [] }), "c2")).toMatchObject({ diskonPersen: 0, golonganId: null, kategori: "Old" });
    expect(await muatPelangganPos(fakeDb({ customers: cust }), "c2")).toEqual({ id: "c2", name: "Lama", phone: "0813", points: 0, pets: [{ id: "p", name: "Mochi", species: "Kucing" }], golonganId: null, golongan: null });
  });

  it("pelanggan yang tidak ada mengembalikan null", async () => {
    expect(await muatPelangganKasir(fakeDb({ customers: null, sales: [], invoices: [] }), "x")).toBeNull();
    expect(await muatPelangganPos(fakeDb({ customers: null }), "x")).toBeNull();
  });
});

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
describe("/api/pelanggan", () => {
  it("menolak tanpa sesi login", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } } as never);
    const { GET } = await import("@/app/api/pelanggan/route");
    const res = await GET(new Request("http://x/api/pelanggan?q=yayan"));
    expect(res.status).toBe(401);
  });

  it("mengabaikan id yang bukan UUID tanpa bertanya ke database", async () => {
    const from = vi.fn();
    const { createClient } = await import("@/lib/supabase/server");
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "u" } } }) }, from } as never);
    const { GET } = await import("@/app/api/pelanggan/route");
    const res = await GET(new Request("http://x/api/pelanggan?id=1;drop&untuk=kasir"));
    expect(await res.json()).toEqual({ data: null });
    expect(from).not.toHaveBeenCalled();
  });
});
