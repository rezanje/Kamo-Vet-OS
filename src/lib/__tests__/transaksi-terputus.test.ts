import { describe, expect, it, vi } from "vitest";
import {
  BATAS_TERPUTUS_MS, PESAN_MASIH_DIPROSES, PESAN_MASIH_DIPROSES_TUTUP_PAKSA, buangStrukTerputus, buangTransaksiTerputus,
  pesanStrukDibuang, pesanTutupPaksa, pesanTutupShift, strukDibuangTutupPaksa, strukSudahPotongStok, strukTerputus,
} from "../transaksi-terputus";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const SEKARANG = Date.parse("2026-11-01T14:00:00Z");
const lalu = (menit: number, dari = SEKARANG) => new Date(dari - menit * 60_000).toISOString();
const plan = [{ method: "Tunai", amount: 35000 }];
const GAGAL_GUARD = "Pembayaran masih diproses. Selesaikan transaksi sebelum menutup shift.";

type Opsi = {
  /** no_struk yang sudah punya mutasi stok penjualan. */
  stok?: Set<string>;
  gagalBacaStok?: boolean;
  gagalHapus?: Set<string>;
  gagalBaca?: boolean;
  /** Baris yang dikembalikan maybeSingle (resumePosCheckout). */
  prior?: Any;
};

// Supabase palsu yang MENEGAKKAN filter yang dikirim kode, bukan sekadar menerimanya:
// mutasi stok hanya ketemu bila source_ref + daftar source-nya benar, dan hapus hanya
// kena bila syarat "belum final" ikut dikirim.
function client(rows: Any[], o: Opsi = {}) {
  const deleted: string[] = [];
  const reads: Record<string, Any>[] = [];
  const stockQueries: Record<string, Any>[] = [];
  const supabase = {
    from(table: string) {
      expect(["sales", "stock_moves"]).toContain(table);
      let mode = "select";
      const filter: Record<string, Any> = {};
      const q: Any = {
        select: () => q,
        delete: () => ((mode = "delete"), q),
        eq: (k: string, v: Any) => ((filter[k] = v), q),
        in: (k: string, v: Any) => ((filter[`in:${k}`] = v), q),
        is: (k: string, v: Any) => ((filter[`is:${k}`] = v), q),
        not: (k: string, op: string, v: Any) => ((filter[`not:${k}`] = [op, v]), q),
        limit: () => q,
        maybeSingle: async () => ({ data: o.prior ?? null, error: null }),
        then: (res: Any, rej: Any) => {
          if (table === "stock_moves") {
            stockQueries.push({ ...filter });
            if (o.gagalBacaStok) return Promise.resolve({ data: null, error: { message: "timeout" } }).then(res, rej);
            const sources: string[] = filter["in:source"] ?? [];
            const ada = o.stok?.has(filter.source_ref) && sources.includes("sale") && sources.includes("sale-group");
            return Promise.resolve({ data: ada ? [{ id: "M1" }] : [], error: null }).then(res, rej);
          }
          if (mode === "delete") {
            const id = filter.id;
            if (o.gagalHapus?.has(id)) return Promise.resolve({ data: null, error: { message: "Akses pembatalan POS ditolak" } }).then(res, rej);
            if (filter["is:payments_finalized_at"] !== null) return Promise.resolve({ data: [], error: null }).then(res, rej);
            deleted.push(id);
            return Promise.resolve({ data: [{ id }], error: null }).then(res, rej);
          }
          reads.push({ ...filter });
          if (o.gagalBaca) return Promise.resolve({ data: null, error: { message: "timeout" } }).then(res, rej);
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        },
      };
      return q;
    },
  };
  return { supabase, deleted, reads, stockQueries };
}

const terputus = (id: string, menit = 60, no_struk: string | null = `POS-${id}`) =>
  ({ id, no_struk, payment_plan: plan, payments_finalized_at: null, created_at: lalu(menit) });

describe("strukTerputus", () => {
  it("hanya struk berencana-bayar yang belum final dan sudah lewat batas", () => {
    expect(strukTerputus({ id: "a", payment_plan: plan, payments_finalized_at: null, created_at: lalu(11) }, SEKARANG)).toBe(true);
    expect(strukTerputus({ id: "b", payment_plan: plan, payments_finalized_at: null, created_at: lalu(3) }, SEKARANG)).toBe(false);
    expect(strukTerputus({ id: "c", payment_plan: plan, payments_finalized_at: lalu(10), created_at: lalu(11) }, SEKARANG)).toBe(false);
    expect(strukTerputus({ id: "d", payment_plan: null, payments_finalized_at: null, created_at: lalu(60) }, SEKARANG)).toBe(false);
    expect(strukTerputus({ id: "e", payment_plan: plan, payments_finalized_at: null }, SEKARANG)).toBe(false);
  });
  it("batasnya 10 menit", () => {
    expect(BATAS_TERPUTUS_MS).toBe(10 * 60_000);
    expect(strukTerputus({ id: "x", payment_plan: plan, payments_finalized_at: null, created_at: lalu(10) }, SEKARANG)).toBe(true);
  });
  it("membaca format timestamptz PostgREST (offset +00:00)", () => {
    expect(strukTerputus({ id: "f", payment_plan: plan, payments_finalized_at: null, created_at: "2026-11-01T02:46:05.6134+00:00" }, SEKARANG)).toBe(true);
  });
});

describe("strukSudahPotongStok", () => {
  it("mencari mutasi stok penjualan dengan nomor struknya", async () => {
    const c = client([], { stok: new Set(["POS-9"]) });
    expect(await strukSudahPotongStok(c.supabase, "POS-9")).toBe(true);
    expect(await strukSudahPotongStok(c.supabase, "POS-8")).toBe(false);
    expect(c.stockQueries[0]).toMatchObject({ source_ref: "POS-9", "in:source": ["sale", "sale-group"] });
  });
  it("gagal-tertutup: gagal baca atau tanpa nomor struk dianggap sudah memotong stok", async () => {
    expect(await strukSudahPotongStok(client([], { gagalBacaStok: true }).supabase, "POS-1")).toBe(true);
    expect(await strukSudahPotongStok(client([]).supabase, null)).toBe(true);
  });
});

describe("buangTransaksiTerputus", () => {
  it("membuang struk terputus milik shift itu dan membiarkan yang masih diproses", async () => {
    const c = client([terputus("lama", 180), terputus("baru", 1)]);
    expect(await buangTransaksiTerputus(c.supabase, "S1", SEKARANG)).toEqual(["lama"]);
    expect(c.deleted).toEqual(["lama"]);
    expect(c.reads[0]).toMatchObject({ shift_id: "S1", "is:payments_finalized_at": null, "not:payment_plan": ["is", null] });
  });
  it("struk terputus yang SUDAH memotong stok (backoffice non-atomik) tidak dibuang — penjaga tetap menahan", async () => {
    const c = client([terputus("stok-keluar"), terputus("bersih")], { stok: new Set(["POS-stok-keluar"]) });
    expect(await buangTransaksiTerputus(c.supabase, "S1", SEKARANG)).toEqual(["bersih"]);
    expect(c.deleted).toEqual(["bersih"]);
  });
  it("mutasi stok tidak terbaca → tidak ada yang dibuang", async () => {
    const c = client([terputus("a"), terputus("b")], { gagalBacaStok: true });
    expect(await buangTransaksiTerputus(c.supabase, "S1", SEKARANG)).toEqual([]);
    expect(c.deleted).toEqual([]);
  });
  it("struk yang ditolak dihapus (mis. milik kasir lain) dilewati tanpa melempar", async () => {
    const c = client([terputus("orang-lain"), terputus("milik-sendiri")], { gagalHapus: new Set(["orang-lain"]) });
    expect(await buangTransaksiTerputus(c.supabase, "S1", SEKARANG)).toEqual(["milik-sendiri"]);
  });
  it("gagal membaca tidak menghapus apa pun", async () => {
    const c = client([], { gagalBaca: true });
    expect(await buangTransaksiTerputus(c.supabase, "S1", SEKARANG)).toEqual([]);
    expect(c.deleted).toEqual([]);
  });
});

describe("buangStrukTerputus", () => {
  it("tidak menyentuh struk yang belum lewat batas", async () => {
    const c = client([]);
    expect(await buangStrukTerputus(c.supabase, terputus("x", 2), SEKARANG)).toBe(false);
    expect(c.stockQueries).toHaveLength(0);
    expect(c.deleted).toEqual([]);
  });
});

describe("pesan penjaga", () => {
  it("tutup shift kasir: menerjemahkan ke bahasa kasir", () => {
    expect(pesanTutupShift(GAGAL_GUARD)).toBe(PESAN_MASIH_DIPROSES);
    expect(pesanTutupShift("Shift sudah ditutup.")).toBe("Shift sudah ditutup.");
  });
  it("tutup paksa: menyuruh kasir pemilik laci, bukan 'selesaikan transaksi'", () => {
    expect(pesanTutupPaksa(GAGAL_GUARD)).toBe(PESAN_MASIH_DIPROSES_TUTUP_PAKSA);
    expect(PESAN_MASIH_DIPROSES_TUTUP_PAKSA).toMatch(/kasir pemilik laci/);
    expect(pesanTutupPaksa("Laci belum 24 jam")).toBe("Laci belum 24 jam");
  });
  it("tutup paksa (basis data belum dimigrasi): tunggu lalu coba lagi, baru kasir / tim teknis", () => {
    expect(PESAN_MASIH_DIPROSES_TUTUP_PAKSA).toMatch(/10 menit/);
    expect(PESAN_MASIH_DIPROSES_TUTUP_PAKSA).toMatch(/tim teknis KAMO/);
    expect(PESAN_MASIH_DIPROSES_TUTUP_PAKSA).not.toMatch(/Selesaikan transaksi/);
  });
  it("pesan kasir tidak lagi menjanjikan Owner/Admin bisa membereskannya", () => {
    expect(PESAN_MASIH_DIPROSES).not.toMatch(/Owner\/Admin/);
  });
});

describe("resumePosCheckout — percobaan terputus dengan draft yang sama", () => {
  async function jalankan(prior: Any, o: Opsi & { failedSaleId?: string } = {}) {
    vi.resetModules();
    const redirects: string[] = [];
    vi.doMock("next/navigation", () => ({ redirect: (url: string) => { redirects.push(url); throw new Error(`REDIRECT ${url}`); } }));
    vi.doMock("@/lib/customer-tier", () => ({ recomputeCustomerTier: async () => undefined }));
    const { resumePosCheckout } = await import("../pos-checkout-identity");
    const c = client([], { ...o, prior });
    let error: unknown = null;
    try { await resumePosCheckout(c.supabase as Any, "U1", { key: "k", fingerprint: "f" }, "cashier", o.failedSaleId); }
    catch (e) { error = e; }
    vi.doUnmock("next/navigation");
    vi.doUnmock("@/lib/customer-tier");
    return { redirects: redirects.map(decodeURIComponent), deleted: c.deleted, error };
  }
  const base = { id: "P1", no_struk: "POS-1", customer_id: null, checkout_fingerprint: "f", payment_plan: plan, payments_finalized_at: null, voided_at: null };
  const tuaMenit = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

  it("struk lama yang tidak pernah final dibuang dan checkout boleh lanjut", async () => {
    const r = await jalankan({ ...base, created_at: tuaMenit(30) });
    expect(r.error).toBeNull();
    expect(r.deleted).toEqual(["P1"]);
  });
  it("draft yang sudah diubah (mis. ganti metode bayar) juga dilepas bila percobaan lamanya terputus", async () => {
    const r = await jalankan({ ...base, checkout_fingerprint: "isi-lama", created_at: tuaMenit(30) });
    expect(r.error).toBeNull();
    expect(r.deleted).toEqual(["P1"]);
  });
  it("struk yang baru saja dibuat tetap ditahan sebagai 'masih diproses'", async () => {
    const r = await jalankan({ ...base, created_at: tuaMenit(0) });
    expect(r.deleted).toEqual([]);
    expect(r.redirects[0]).toMatch(/masih diproses/i);
  });
  it("struk terputus yang sudah memotong stok tidak dibuang dan tidak dipotong ulang", async () => {
    const r = await jalankan({ ...base, created_at: tuaMenit(30) }, { stok: new Set(["POS-1"]) });
    expect(r.deleted).toEqual([]);
    expect(r.redirects[0]).toMatch(/masih diproses/i);
  });
  it("struk yang baru gagal di permintaan yang sama tidak ikut dibuang di sini", async () => {
    const r = await jalankan({ ...base, created_at: tuaMenit(30) }, { failedSaleId: "P1" });
    expect(r.error).toBeNull();
    expect(r.deleted).toEqual([]);
  });
  it("struk yang sudah final tetap diarahkan ke struknya, tidak dibuang", async () => {
    const r = await jalankan({ ...base, payments_finalized_at: tuaMenit(29), created_at: tuaMenit(30) });
    expect(r.deleted).toEqual([]);
    expect(r.redirects[0]).toMatch(/\/kasir\/struk\/P1/);
  });
});

describe("struk yang dibuang tutup paksa", () => {
  it("membaca nomor struk dari hasil fungsi supervisor", () => {
    expect(strukDibuangTutupPaksa({ removed_pending_sales: ["POS-1", "POS-2"] })).toEqual(["POS-1", "POS-2"]);
    expect(strukDibuangTutupPaksa({ removed_pending_sales: [] })).toEqual([]);
  });
  it("hasil lama / kosong / aneh tidak dianggap membuang apa pun", () => {
    expect(strukDibuangTutupPaksa(null)).toEqual([]);
    expect(strukDibuangTutupPaksa({ shift_id: "x", status: "closed" })).toEqual([]);
    expect(strukDibuangTutupPaksa({ removed_pending_sales: "POS-1" })).toEqual([]);
    expect(strukDibuangTutupPaksa({ removed_pending_sales: ["POS-1", 2, null, " "] })).toEqual(["POS-1"]);
  });
  it("catatan layar menyebut jumlah, nomor, dan meminta toko mengecek input ulang", () => {
    const teks = pesanStrukDibuang("POS-20261101-0004-8GZC,POS-20261101-0009");
    expect(teks).toMatch(/^2 transaksi kasir yang terputus ikut dibuang/);
    expect(teks).toContain("POS-20261101-0004-8GZC, POS-20261101-0009");
    expect(teks).toMatch(/diinput ulang/);
  });
  it("tanpa nomor tidak ada catatan; isi URL dipangkas", () => {
    expect(pesanStrukDibuang(undefined)).toBeNull();
    expect(pesanStrukDibuang(" , ")).toBeNull();
    const panjang = pesanStrukDibuang(Array.from({ length: 50 }, (_, i) => `POS-${i}`.padEnd(80, "x")).join(","))!;
    expect(panjang).toMatch(/^20 transaksi/);
    expect(panjang).not.toMatch(/x{41}/);
  });
});
