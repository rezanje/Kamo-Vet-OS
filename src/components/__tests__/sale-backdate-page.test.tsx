// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Cancel = Record<string, unknown>;
const state = vi.hoisted(() => ({
  role: "OWNER", allowed: true, allowedError: false, channel: null as string | null, marketplace: "piutang", open: false, cycle: false, shift: "open",
  receiptError: false, voided: false, voucher: null as string | null, promo: false, payrollCount: 0, payrollError: false,
  bounds: null as unknown, boundsError: false, boundsCalls: [] as unknown[], effective: null as string | null,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
vi.mock("@/components/dokumen/DokumenPanel", () => ({ DokumenPanel: () => null }));
vi.mock("@/app/(app)/penjualan/[id]/SaleCancelForm", () => ({ SaleCancelForm: () => <span>form batal penjualan</span> }));
vi.mock("@/app/(app)/penjualan/[id]/SalePaymentCorrectionForm", () => ({ SalePaymentCorrectionForm: () => <span>form koreksi metode</span> }));
vi.mock("@/app/(app)/penjualan/[id]/SaleReceiptForms", () => ({
  SaleReceiptCancelForm: (p: { batasTanggal?: unknown }) => <span>form batalkan penerimaan batas:{JSON.stringify(p.batasTanggal ?? null)}</span>,
  SaleReceiveAgainForm: (p: { batasTanggal?: unknown }) => <span>form terima ulang batas:{JSON.stringify(p.batasTanggal ?? null)}</span>,
  OnlineDisbursementCancelForm: (p: { batasTanggal?: unknown }) => <span>form batalkan pencairan batas:{JSON.stringify(p.batasTanggal ?? null)}</span>,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "viewer" } } }) },
  rpc: async (name: string, args: unknown) => { if (name === "pos_receipt_date_bounds") { state.boundsCalls.push(args); return state.boundsError ? { data: null, error: { message: "boom" } } : { data: state.bounds, error: null }; } return state.allowedError ? { data: null, error: { message: "boom" } } : { data: state.allowed, error: null }; },
  from(table: string) {
    const sale = { id: "sale", revision: 3, channel: state.channel, void_reason: null, branch_id: "b1", shift_id: "s1", marketplace_status: state.channel ? state.marketplace : null,
      no_struk: "S-100", created_at: "2026-11-01T01:00:00Z", subtotal: 100000, discount: 0, total: 100000, merchant_fee_total: 0, metode_bayar: "Tunai", bayar: 100000, kembali: 0,
      payment_plan: state.channel ? null : [], payments_finalized_at: state.channel ? null : "2026-11-01T01:00:00Z", voided_at: state.voided ? "2026-11-03T08:00:00Z" : null,
      sale_payments: state.channel ? [] : [{ method: "Tunai", amount: 100000, fee_amount: 0, fee_percent: 0 }], branches: { name: "A" }, customers: null, kasir: { full_name: "Kasir" }, voucher_code: state.voucher, sale_items: state.promo ? [{ id: "i1", nama: "Pakan", qty: 1, harga: 100000, satuan: "pcs", promo_id: "p1" }] : [] };
    const cancel: Cancel = { id: "c1", reason: "Salah metode", created_at: "2026-11-05T08:00:00Z", created_by: "u-owner", source_shift_status: state.shift, source_shift_id: "s1",
      effect_shift_id: state.shift === "closed" ? "s2" : "s1", before_payments: [{ method: "Tunai", amount: 100000 }], after_payments: state.open ? null : [{ method: "QRIS", amount: 100000 }],
      closed_at: state.open ? null : "2026-11-05T09:00:00Z", closed_by: "u-owner", closed_kind: state.open ? null : "diterima-ulang", effective_date: state.effective, receive_effective_date: state.open ? null : state.effective, receive_reason: state.open ? null : "Dibayar di hari struk" };
    const lists: Record<string, unknown[]> = {
      pos_receipt_cancellations: state.open || state.cycle ? [cancel] : [],
      online_disbursement_cancellations: state.channel ? [{ id: "o1", reason: "Nominal salah", created_at: "2026-11-05T08:00:00Z", created_by: "u-owner", amount_bank: 90000, amount_fee: 10000 }] : [],
      sales_returns: [], sale_payment_corrections: [], profiles: [{ id: "u-owner", full_name: "Rina Owner" }],
    };
    const q: Record<string, unknown> = {};
    for (const name of ["select", "eq", "order", "in", "limit"]) q[name] = () => q;
    q.maybeSingle = async () => ({ data: table === "profiles" ? { role: state.role, is_active: true } : table === "sales" ? sale : table === "cashier_shifts" ? { status: state.shift } : null, error: null });
    q.then = (resolve: (value: unknown) => void) => resolve(table === "payrolls" ? (state.payrollError ? { data: null, count: null, error: { message: "boom" } } : { data: null, count: state.payrollCount, error: null }) : table === "pos_receipt_cancellations" && state.receiptError ? { data: null, error: { message: "boom" } } : { data: lists[table] ?? [], error: null });
    return q;
  },
}) }));

import PenjualanDetailPage from "@/app/(app)/penjualan/[id]/page";
const render = async (searchParams: Record<string, string> = {}) => renderToStaticMarkup(await PenjualanDetailPage({ params: Promise.resolve({ id: "sale" }), searchParams: Promise.resolve(searchParams) }));

beforeEach(() => Object.assign(state, { role: "OWNER", allowed: true, allowedError: false, channel: null, marketplace: "piutang", open: false, cycle: false, shift: "open", receiptError: false, voided: false, voucher: null, promo: false, payrollCount: 0, payrollError: false, bounds: null, boundsError: false, boundsCalls: [], effective: null }));

const BOUNDS = { min_date: "2026-11-01", max_date: "2026-11-12", today: "2026-11-12", closed_until: "2026-11-02", effective_min: "2026-11-03", can_backdate: true };
const batas = (html: string) => { const m = /batas:([^<]*)</.exec(html.replace(/&quot;/g, "\"")); return m ? JSON.parse(m[1]) : undefined; };

describe("Tanggal efektif: layar detail penjualan", () => {
  it("struk terbayar: rentang dibaca dari database (batal) dan diteruskan ke formulir", async () => {
    state.bounds = BOUNDS;
    const html = await render();
    expect(state.boundsCalls).toEqual([{ p_sale_id: "sale", p_op: "cancel" }]);
    expect(batas(html)).toEqual({ min: "2026-11-01", max: "2026-11-12", closedUntil: "2026-11-02", effectiveMin: "2026-11-03", canBackdate: true });
  });
  it("struk belum dibayar: rentang terima ulang (op=receive); banner menyebut tanggal pembukuan pembatalan", async () => {
    state.bounds = { ...BOUNDS, min_date: "2026-11-05", effective_min: "2026-11-05", closed_until: null };
    state.open = true; state.effective = "2026-11-03";
    const html = await render();
    expect(state.boundsCalls).toEqual([{ p_sale_id: "sale", p_op: "receive" }]);
    expect(html).toContain("form terima ulang");
    expect(html).toContain("Dibukukan di tanggal 03/11/2026 (dicatat 05/11/2026)");
  });
  it("order marketplace yang sudah cair: rentang pencairan (op=online)", async () => {
    state.bounds = BOUNDS; state.channel = "Shopee"; state.marketplace = "cair";
    const html = await render();
    expect(state.boundsCalls).toEqual([{ p_sale_id: "sale", p_op: "online" }]);
    expect(html).toContain("form batalkan pencairan");
  });
  it("order marketplace yang belum cair: tidak ada formulir, rentang tidak dibaca", async () => {
    state.channel = "Shopee"; state.marketplace = "piutang";
    await render();
    expect(state.boundsCalls).toEqual([]);
  });
  it("rentang gagal dibaca: Owner tidak dikunci layar (rentang dasar tanggal struk .. hari ini, boleh mundur); bentuk jawaban rusak sama", async () => {
    state.boundsError = true;
    const owner = batas(await render());
    expect(owner.canBackdate).toBe(true);
    expect(owner.min).toBe("2026-11-01");
    state.boundsError = false; state.bounds = { nonsense: true };
    expect(batas(await render()).canBackdate).toBe(true);
  });
  it("rentang gagal dibaca untuk peran lain (ADMIN berizin): hanya hari ini", async () => {
    state.role = "ADMIN"; state.boundsError = true;
    const admin = batas(await render());
    expect(admin.canBackdate).toBe(false);
    expect(admin.min).toBe(admin.max);
  });
  it("peran tanpa izin batalkan: formulir tidak tampil dan rentang tidak dibaca", async () => {
    state.role = "ADMIN"; state.allowed = false;
    const html = await render();
    expect(html).not.toContain("form batalkan penerimaan");
    expect(state.boundsCalls).toEqual([]);
  });
  it("struk sudah dibatalkan: tidak ada formulir, rentang tidak dibaca", async () => {
    state.voided = true;
    await render();
    expect(state.boundsCalls).toEqual([]);
  });
  it("banner sukses menyebut tanggal pembukuan hanya bila ada penanda tgl valid", async () => {
    expect(await render({ success: "receipt-cancelled", tgl: "2026-11-10" })).toContain("Dibukukan di tanggal 10/11/2026 (bukan hari ini)");
    expect(await render({ success: "receipt-received", tgl: "2026-11-10" })).toContain("Dibukukan di tanggal 10/11/2026");
    expect(await render({ success: "disbursement-cancelled", tgl: "2026-11-10" })).toContain("Dibukukan di tanggal 10/11/2026");
    expect(await render({ success: "receipt-cancelled" })).not.toContain("Dibukukan di tanggal");
    expect(await render({ success: "receipt-cancelled", tgl: "2026-02-30" })).not.toContain("Dibukukan di tanggal");
    expect(await render({ success: "receipt-cancelled", tgl: "<script>" })).not.toContain("<script>");
  });
});
