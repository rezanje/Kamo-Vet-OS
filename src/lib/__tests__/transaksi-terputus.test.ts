import { describe, expect, it } from "vitest";
import {
  BATAS_TERPUTUS_MS, PESAN_MASIH_DIPROSES, buangTransaksiTerputus, pesanTutupShift, strukTerputus,
} from "../transaksi-terputus";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const SEKARANG = Date.parse("2026-11-01T14:00:00Z");
const lalu = (menit: number) => new Date(SEKARANG - menit * 60_000).toISOString();
const plan = [{ method: "Tunai", amount: 35000 }];

function client(rows: Any[], o: { gagalHapus?: Set<string>; gagalBaca?: boolean } = {}) {
  const deleted: string[] = [];
  const reads: Record<string, Any>[] = [];
  return {
    deleted, reads,
    from(table: string) {
      expect(table).toBe("sales");
      let mode = "select";
      const filter: Record<string, Any> = {};
      const q: Any = {
        select: () => q,
        delete: () => ((mode = "delete"), q),
        eq: (k: string, v: Any) => ((filter[k] = v), q),
        is: (k: string, v: Any) => ((filter[`is:${k}`] = v), q),
        not: (k: string, op: string, v: Any) => ((filter[`not:${k}`] = [op, v]), q),
        then: (res: Any, rej: Any) => {
          if (mode === "delete") {
            const id = filter.id;
            if (o.gagalHapus?.has(id)) return Promise.resolve({ data: null, error: { message: "Akses pembatalan POS ditolak" } }).then(res, rej);
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
}

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
});

describe("buangTransaksiTerputus", () => {
  it("membuang struk terputus milik shift itu dan membiarkan yang masih diproses", async () => {
    const c = client([
      { id: "lama", no_struk: "POS-1", payment_plan: plan, payments_finalized_at: null, created_at: lalu(180) },
      { id: "baru", no_struk: "POS-2", payment_plan: plan, payments_finalized_at: null, created_at: lalu(1) },
    ]);
    expect(await buangTransaksiTerputus(c, "S1", SEKARANG)).toEqual(["lama"]);
    expect(c.deleted).toEqual(["lama"]);
    expect(c.reads[0]).toMatchObject({ shift_id: "S1", "is:payments_finalized_at": null, "not:payment_plan": ["is", null] });
  });
  it("struk yang ditolak dihapus (mis. milik kasir lain) dilewati tanpa melempar", async () => {
    const c = client([
      { id: "orang-lain", payment_plan: plan, payments_finalized_at: null, created_at: lalu(60) },
      { id: "milik-sendiri", payment_plan: plan, payments_finalized_at: null, created_at: lalu(60) },
    ], { gagalHapus: new Set(["orang-lain"]) });
    expect(await buangTransaksiTerputus(c, "S1", SEKARANG)).toEqual(["milik-sendiri"]);
  });
  it("gagal membaca tidak menghapus apa pun", async () => {
    const c = client([], { gagalBaca: true });
    expect(await buangTransaksiTerputus(c, "S1", SEKARANG)).toEqual([]);
    expect(c.deleted).toEqual([]);
  });
});

describe("pesanTutupShift", () => {
  it("menerjemahkan penjaga database ke bahasa kasir", () => {
    expect(pesanTutupShift("Pembayaran masih diproses. Selesaikan transaksi sebelum menutup shift.")).toBe(PESAN_MASIH_DIPROSES);
    expect(pesanTutupShift("Shift sudah ditutup.")).toBe("Shift sudah ditutup.");
  });
});

describe("resumePosCheckout — draft yang sama sesudah percobaan terputus", () => {
  async function jalankan(prior: Any) {
    const { vi } = await import("vitest");
    vi.resetModules();
    const redirects: string[] = [];
    vi.doMock("next/navigation", () => ({ redirect: (url: string) => { redirects.push(url); throw new Error(`REDIRECT ${url}`); } }));
    vi.doMock("@/lib/customer-tier", () => ({ recomputeCustomerTier: async () => undefined }));
    const { resumePosCheckout } = await import("../pos-checkout-identity");
    const deleted: string[] = [];
    const supabase: Any = { from: () => {
      let mode = "select"; let id = "";
      const q: Any = {
        select: () => q, delete: () => ((mode = "delete"), q), is: () => q,
        eq: (k: string, v: string) => { if (k === "id") id = v; return q; },
        maybeSingle: async () => ({ data: prior, error: null }),
        then: (res: Any) => { if (mode === "delete") deleted.push(id); return Promise.resolve({ data: [{ id }], error: null }).then(res); },
      };
      return q;
    } };
    let error: unknown = null;
    try { await resumePosCheckout(supabase, "U1", { key: "k", fingerprint: "f" }, "cashier"); }
    catch (e) { error = e; }
    vi.doUnmock("next/navigation");
    vi.doUnmock("@/lib/customer-tier");
    return { redirects, deleted, error };
  }
  const base = { id: "P1", no_struk: "POS-1", customer_id: null, checkout_fingerprint: "f", payment_plan: plan, payments_finalized_at: null, voided_at: null };

  it("struk lama yang tidak pernah final dibuang dan checkout boleh lanjut", async () => {
    const r = await jalankan({ ...base, created_at: new Date(Date.now() - 30 * 60_000).toISOString() });
    expect(r.error).toBeNull();
    expect(r.deleted).toEqual(["P1"]);
  });
  it("struk yang baru saja dibuat tetap ditahan sebagai 'masih diproses'", async () => {
    const r = await jalankan({ ...base, created_at: new Date().toISOString() });
    expect(r.deleted).toEqual([]);
    expect(decodeURIComponent(r.redirects[0] ?? "")).toMatch(/masih diproses/i);
  });
});
