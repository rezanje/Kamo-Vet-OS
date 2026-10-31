import { describe, expect, it } from "vitest";
import { ListLoadError } from "@/lib/checked-list";
import {
  adalahRiwayatBersama, bacaDetailRiwayatBersama, bacaRiwayatBersamaHewan, ownerAktif,
  PESAN_GAGAL_RIWAYAT_BERSAMA, PESAN_RIWAYAT_BERSAMA_TERLALU_BANYAK,
} from "@/lib/riwayat-bersama";

const PET = "pet-a", CUST = "cust-a";
const row = (i: number, over: Record<string, unknown> = {}) => ({
  visit_id: `v-${String(i).padStart(5, "0")}`, pet_id: PET, customer_id: CUST, tanggal: `2026-01-14T17:00:00+00:00`,
  dokter: "drh. Fiktif", keluhan: null, diagnosis: `Dx ${i}`, anamnesis: null, gejala_klinis: null, terapi: `Terapi ${i}`, ...over,
});

/** Fake RPC with the database bounds (1–200 per page, offset ≤ 10000). */
function client(total: number, opts: { error?: unknown; mutate?: (rows: Record<string, unknown>[], dari: number) => Record<string, unknown>[]; detail?: unknown } = {}) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    rpc: async (name: string, args: Record<string, number | string>) => {
      calls.push({ name, ...args });
      if (opts.error) return { data: null, error: opts.error };
      if (name === "detail_riwayat_bersama") return opts.detail as { data: unknown; error: unknown };
      const dari = args.p_dari as number, jumlah = args.p_jumlah as number;
      if (jumlah < 1 || jumlah > 200 || dari < 0 || dari > 10000) return { data: null, error: { code: "22023" } };
      let rows: Record<string, unknown>[] = Array.from({ length: Math.max(0, Math.min(jumlah, total - dari)) }, (_, k) => row(dari + k));
      if (opts.mutate) rows = opts.mutate(rows, dari);
      return { data: rows, error: null };
    },
  };
}

describe("bacaRiwayatBersamaHewan", () => {
  it("reads every page in order and stops at the first short page", async () => {
    const c = client(205);
    const rows = await bacaRiwayatBersamaHewan(c, PET, CUST);
    expect(rows).toHaveLength(205);
    expect(new Set(rows.map(r => r.visit_id)).size).toBe(205);
    expect(c.calls.map(x => [x.p_dari, x.p_jumlah])).toEqual([[0, 200], [200, 200]]);
    expect(rows[0].terapi).toBe("Terapi 0");
  });
  it("returns an empty list only when the database answers empty", async () => {
    expect(await bacaRiwayatBersamaHewan(client(0), PET, CUST)).toEqual([]);
  });
  it("accepts exactly 1000 rows after an explicit probe for row 1001", async () => {
    const c = client(1000);
    expect(await bacaRiwayatBersamaHewan(c, PET, CUST)).toHaveLength(1000);
    expect(c.calls.map(x => [x.p_dari, x.p_jumlah])).toEqual([[0, 200], [200, 200], [400, 200], [600, 200], [800, 200], [1000, 1]]);
  });
  it("fails explicitly at 1001 rows instead of truncating or claiming complete", async () => {
    await expect(bacaRiwayatBersamaHewan(client(1001), PET, CUST)).rejects.toThrow(PESAN_RIWAYAT_BERSAMA_TERLALU_BANYAK);
    await expect(bacaRiwayatBersamaHewan(client(5000), PET, CUST)).rejects.toBeInstanceOf(ListLoadError);
  });
  it.each([
    ["a denied call (42501)", { error: { code: "42501", message: "PRIVATE detail" } }],
    ["a broken connection", { error: { message: "fetch failed" } }],
  ])("turns %s into a generic failure, never an empty list", async (_label, opts) => {
    const error = await bacaRiwayatBersamaHewan(client(2, opts), PET, CUST).catch(e => e);
    expect(error).toBeInstanceOf(ListLoadError);
    expect(error.message).toBe(PESAN_GAGAL_RIWAYAT_BERSAMA);
    expect(error.message).not.toContain("PRIVATE");
  });
  it.each([
    ["another pet", (rows: Record<string, unknown>[]) => rows.map((r, i) => i === 1 ? { ...r, pet_id: "pet-b" } : r)],
    ["another customer", (rows: Record<string, unknown>[]) => rows.map((r, i) => i === 1 ? { ...r, customer_id: "cust-b" } : r)],
    ["a duplicate visit across pages", (rows: Record<string, unknown>[], dari: number) => dari === 200 ? [row(0), ...rows.slice(1)] : rows],
    ["a malformed row", (rows: Record<string, unknown>[]) => rows.map((r, i) => i === 0 ? { ...r, tanggal: "bukan tanggal" } : r)],
    ["a non-text clinical field", (rows: Record<string, unknown>[]) => rows.map((r, i) => i === 0 ? { ...r, terapi: 7 } : r)],
    ["more rows than requested", (rows: Record<string, unknown>[]) => [...rows, row(9999)]],
  ])("rejects %s (pet↔customer↔visit consistency)", async (_label, mutate) => {
    await expect(bacaRiwayatBersamaHewan(client(205, { mutate }), PET, CUST)).rejects.toThrow(PESAN_GAGAL_RIWAYAT_BERSAMA);
  });
});

describe("bacaDetailRiwayatBersama", () => {
  const detail = (d: unknown) => client(0, { detail: d });
  it("returns the row when the database returns exactly that visit", async () => {
    const r = await bacaDetailRiwayatBersama(detail({ data: [row(1, { visit_id: "v-1" })], error: null }), "v-1");
    expect(r).toEqual({ status: "ada", row: expect.objectContaining({ visit_id: "v-1", terapi: "Terapi 1" }) });
  });
  it("is 'tidak-ada' only for an empty answer", async () => {
    expect(await bacaDetailRiwayatBersama(detail({ data: [], error: null }), "v-1")).toEqual({ status: "tidak-ada" });
  });
  it.each([
    ["an error", { data: null, error: { code: "42501" } }],
    ["a non-array", { data: { visit_id: "v-1" }, error: null }],
    ["two rows", { data: [row(1, { visit_id: "v-1" }), row(1, { visit_id: "v-1" })], error: null }],
    ["another visit", { data: [row(2)], error: null }],
    ["a malformed row", { data: [{ visit_id: "v-1" }], error: null }],
  ])("is 'gagal' (not not-found) for %s", async (_label, answer) => {
    expect(await bacaDetailRiwayatBersama(detail(answer), "v-1")).toEqual({ status: "gagal" });
  });
  it("is 'gagal' when the call throws", async () => {
    expect(await bacaDetailRiwayatBersama({ rpc: async () => { throw new Error("x"); } }, "v-1")).toEqual({ status: "gagal" });
  });
});

describe("ownerAktif / adalahRiwayatBersama", () => {
  const profile = (answer: unknown) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => answer }) }) }) });
  it("is true only for an active OWNER and throws when the profile cannot be read", async () => {
    expect(await ownerAktif(profile({ data: { role: "OWNER", is_active: true }, error: null }), "u")).toBe(true);
    expect(await ownerAktif(profile({ data: { role: "OWNER", is_active: false }, error: null }), "u")).toBe(false);
    expect(await ownerAktif(profile({ data: { role: "ADMIN", is_active: true }, error: null }), "u")).toBe(false);
    expect(await ownerAktif(profile({ data: null, error: null }), "u")).toBe(false);
    expect(await ownerAktif(profile({ data: null, error: null }), null)).toBe(false);
    await expect(ownerAktif(profile({ data: null, error: { message: "x" } }), "u")).rejects.toBeInstanceOf(ListLoadError);
  });
  it("matches the database reader: no branch and an import key", () => {
    expect(adalahRiwayatBersama({ branch_id: null, legacy_source_key: "k" })).toBe(true);
    expect(adalahRiwayatBersama({ branch_id: "b", legacy_source_key: "k" })).toBe(false);
    expect(adalahRiwayatBersama({ branch_id: null, legacy_source_key: null })).toBe(false);
  });
});
