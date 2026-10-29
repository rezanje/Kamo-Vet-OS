import { describe, expect, it } from "vitest";
import {
  alasanTidakBisaRetur, bisaBatalReturGrosir, bisaReturGrosir, pratinjauRetur, sisaPiutangGrosir, sisaQtyRetur,
  type BarisFakturRetur, type ReturAktif,
} from "../retur-grosir";

// Same fictional invoice as supabase/tests/wholesale_returns.sql: DPP 320, PPN 35, total 355.
const baris: BarisFakturRetur[] = [
  { id: "box", nama: "Food box", satuan: "box", qty: 2, harga: 110, diskon: 0, hpp: 62, stok: true },
  { id: "pcs", nama: "Food pcs", satuan: "pcs", qty: 5, harga: 10, diskon: 0, hpp: 15, stok: true },
  { id: "svc", nama: "Service", satuan: "unit", qty: 1, harga: 50, diskon: 0, hpp: 0, stok: false },
];
const faktur = { dpp: 320, ppn: 35 };

describe("pratinjau retur grosir", () => {
  it("partial return of an unpaid invoice reduces the receivable", () => {
    expect(pratinjauRetur({ faktur, baris, aktif: [], qty: { box: 1 }, sisaPiutang: 355 }))
      .toEqual({ gross: 110, diskon: 0, ppn: 12, total: 122, piutang: 122, kredit: 0, hpp: 31, valid: true });
  });
  it("the rest of a partly paid invoice becomes customer credit and totals reverse the invoice exactly", () => {
    const aktif: ReturAktif[] = [{ gross: 110, diskon: 0, ppn: 12, items: [{ invoice_item_id: "box", qty: 1, gross: 110, diskon: 0, hpp: 31 }] }];
    const hasil = pratinjauRetur({ faktur, baris, aktif, qty: { box: 1, pcs: 5, svc: 1 }, sisaPiutang: 33 });
    expect(hasil).toEqual({ gross: 210, diskon: 0, ppn: 23, total: 233, piutang: 33, kredit: 200, hpp: 46, valid: true });
    expect(110 + hasil.gross).toBe(320);
    expect(122 + hasil.total).toBe(355);
    expect(sisaQtyRetur(baris, aktif).get("box")).toBe(1);
  });
  it("over-return and empty selections are not valid", () => {
    expect(pratinjauRetur({ faktur, baris, aktif: [], qty: { box: 3 }, sisaPiutang: 355 }).valid).toBe(false);
    expect(pratinjauRetur({ faktur, baris, aktif: [], qty: {}, sisaPiutang: 355 }).valid).toBe(false);
    expect(pratinjauRetur({ faktur, baris, aktif: [], qty: { box: -1 }, sisaPiutang: 355 }).valid).toBe(false);
  });
  it("line discounts are reversed proportionally to the contra-revenue account", () => {
    const diskon: BarisFakturRetur[] = [{ id: "a", nama: "A", satuan: "pcs", qty: 4, harga: 100, diskon: 40, hpp: 0, stok: false }];
    expect(pratinjauRetur({ faktur: { dpp: 360, ppn: 0 }, baris: diskon, aktif: [], qty: { a: 1 }, sisaPiutang: 0 }))
      .toEqual({ gross: 100, diskon: 10, ppn: 0, total: 90, piutang: 0, kredit: 90, hpp: 0, valid: true });
  });
});

describe("akses dan sisa piutang", () => {
  it("creates by OWNER/ADMIN/FINANCE, voids by OWNER/FINANCE only", () => {
    expect(bisaReturGrosir({ role: "ADMIN", is_active: true })).toBe(true);
    expect(bisaReturGrosir({ role: "STAFF", is_active: true })).toBe(false);
    expect(bisaReturGrosir({ role: "OWNER", is_active: false })).toBe(false);
    expect(bisaBatalReturGrosir({ role: "FINANCE", is_active: true })).toBe(true);
    expect(bisaBatalReturGrosir({ role: "ADMIN", is_active: true })).toBe(false);
  });
  it("outstanding subtracts return reductions; cancelled invoices owe nothing", () => {
    expect(sisaPiutangGrosir({ total: 355, carried_paid: 0, returned_ar: 122 }, 200)).toBe(33);
    expect(sisaPiutangGrosir({ total: 355, carried_paid: 0, returned_ar: 155 }, 200)).toBe(0);
    expect(sisaPiutangGrosir({ status: "batal", total: 355 }, 0)).toBe(0);
  });
  it("only posted order invoices can be returned", () => {
    const ok = { status: "berjalan", order_id: "o", opening_batch_id: null, kategori: null };
    expect(alasanTidakBisaRetur(ok, false)).toBeNull();
    expect(alasanTidakBisaRetur({ ...ok, status: "batal" }, false)).toMatch(/dibatalkan/);
    expect(alasanTidakBisaRetur(ok, true)).toMatch(/diganti/);
    expect(alasanTidakBisaRetur({ ...ok, opening_batch_id: "b" }, false)).toMatch(/saldo awal/);
    expect(alasanTidakBisaRetur({ ...ok, kategori: "selisih_stok" }, false)).toMatch(/opname/);
    expect(alasanTidakBisaRetur({ ...ok, order_id: null }, false)).toMatch(/pesanan/);
  });
});
