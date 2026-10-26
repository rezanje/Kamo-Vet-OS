import { describe, expect, it } from "vitest";
import { loadActiveVouchers } from "../voucher-loader";
import { normalizeKode, pesanVoucherDitolak, potonganVoucher } from "../voucher";

const row = (i: number) => ({
  id: `voucher-${String(i).padStart(4, "0")}`, code: `CODE${String(i).padStart(4, "0")}`,
  tipe: "nominal", nilai: 2000, is_active: true, valid_from: null,
  valid_until: null, max_potongan: null, min_belanja: 0,
  boleh_gabung_promo: true, customer_id: null, category_id: null,
});

function source(rows: ReturnType<typeof row>[], brokenAt?: number) {
  const calls: Array<{ from: number; count: string | undefined; order: string | undefined }> = [];
  const db = { from(table: string) {
    expect(table).toBe("vouchers");
    let count: string | undefined;
    let order: string | undefined;
    return {
      select(_columns: string, opts?: { count: string }) { count = opts?.count; return this; },
      eq(key: string, value: unknown) { expect([key, value]).toEqual(["is_active", true]); return this; },
      order(key: string) { order = key; return this; },
      range(from: number, to: number) {
        calls.push({ from, count, order });
        return Promise.resolve(from === brokenAt
          ? { data: null, count: rows.length, error: { message: "backend detail" } }
          : { data: rows.slice(from, to + 1), count: rows.length, error: null });
      },
    };
  } };
  return { db, calls };
}

describe("complete active voucher read for checkout display", () => {
  it("finds and prices a valid campaign code beyond the first response page", async () => {
    const { db, calls } = source(Array.from({ length: 1205 }, (_, i) => row(i)));
    const vouchers = await loadActiveVouchers(db);
    const late = vouchers.find(v => v.code === normalizeKode("code1204"));
    expect(late).toBeDefined();
    expect(pesanVoucherDitolak(late ?? null, "2026-10-26", { dasar: 10000, adaPromoOtomatis: false })).toBeNull();
    expect(potonganVoucher(10000, late!)).toBe(2000);
    expect(calls.map(call => call.from)).toEqual([0, 500, 1000]);
    expect(calls.every(call => call.count === "exact" && call.order === "id")).toBe(true);
  });

  it("does not present an incomplete voucher list if a later page fails", async () => {
    const { db } = source(Array.from({ length: 600 }, (_, i) => row(i)), 500);
    await expect(loadActiveVouchers(db)).rejects.toThrow(/voucher aktif/i);
  });
});
