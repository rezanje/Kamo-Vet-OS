// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Cancel = Record<string, unknown>;
const state = vi.hoisted(() => ({
  role: "OWNER", allowed: true, allowedError: false, channel: null as string | null, marketplace: "piutang", open: false, cycle: false, shift: "open",
  receiptError: false, voided: false, voucher: null as string | null, promo: false, payrollCount: 0, payrollError: false,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
vi.mock("@/components/dokumen/DokumenPanel", () => ({ DokumenPanel: () => null }));
vi.mock("@/app/(app)/penjualan/[id]/SaleCancelForm", () => ({ SaleCancelForm: () => <span>form batal penjualan</span> }));
vi.mock("@/app/(app)/penjualan/[id]/SalePaymentCorrectionForm", () => ({ SalePaymentCorrectionForm: () => <span>form koreksi metode</span> }));
vi.mock("@/app/(app)/penjualan/[id]/SaleReceiptForms", () => ({
  SaleReceiptCancelForm: (p: { shiftClosed: boolean; ubahTerhalang?: string[] }) => <span>form batalkan penerimaan{p.shiftClosed ? " shift-tertutup" : ""}{p.ubahTerhalang?.length ? ` terhalang:${p.ubahTerhalang.join("|")}` : ""}</span>,
  SaleReceiveAgainForm: (p: { previous: { method: string }[] }) => <span>form terima ulang {p.previous.map(x => x.method).join("+")}</span>,
  OnlineDisbursementCancelForm: () => <span>form batalkan pencairan</span>,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "viewer" } } }) },
  rpc: async () => state.allowedError ? { data: null, error: { message: "boom" } } : { data: state.allowed, error: null },
  from(table: string) {
    const sale = { id: "sale", revision: 3, channel: state.channel, void_reason: null, branch_id: "b1", shift_id: "s1", marketplace_status: state.channel ? state.marketplace : null,
      no_struk: "S-100", created_at: "2026-11-01T01:00:00Z", subtotal: 100000, discount: 0, total: 100000, merchant_fee_total: 0, metode_bayar: "Tunai", bayar: 100000, kembali: 0,
      payment_plan: state.channel ? null : [], payments_finalized_at: state.channel ? null : "2026-11-01T01:00:00Z", voided_at: state.voided ? "2026-11-03T08:00:00Z" : null,
      sale_payments: state.channel ? [] : [{ method: "Tunai", amount: 100000, fee_amount: 0, fee_percent: 0 }], branches: { name: "A" }, customers: null, kasir: { full_name: "Kasir" }, voucher_code: state.voucher, sale_items: state.promo ? [{ id: "i1", nama: "Pakan", qty: 1, harga: 100000, satuan: "pcs", promo_id: "p1" }] : [] };
    const cancel: Cancel = { id: "c1", reason: "Salah metode", created_at: "2026-11-05T08:00:00Z", created_by: "u-owner", source_shift_status: state.shift, source_shift_id: "s1",
      effect_shift_id: state.shift === "closed" ? "s2" : "s1", before_payments: [{ method: "Tunai", amount: 100000 }], after_payments: state.open ? null : [{ method: "QRIS", amount: 100000 }],
      closed_at: state.open ? null : "2026-11-05T09:00:00Z", closed_by: "u-owner", closed_kind: state.open ? null : "diterima-ulang" };
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
const render = async () => renderToStaticMarkup(await PenjualanDetailPage({ params: Promise.resolve({ id: "sale" }), searchParams: Promise.resolve({}) }));

beforeEach(() => Object.assign(state, { role: "OWNER", allowed: true, allowedError: false, channel: null, marketplace: "piutang", open: false, cycle: false, shift: "open", receiptError: false, voided: false, voucher: null, promo: false, payrollCount: 0, payrollError: false }));

describe("Batalkan penerimaan: layar detail penjualan", () => {
  it("OWNER melihat tombol Batalkan penerimaan, Koreksi metode, dan Batalkan penjualan untuk struk terbayar", async () => {
    const html = await render();
    expect(html).toContain("form batalkan penerimaan");
    expect(html).toContain("form koreksi metode");
    expect(html).toContain("form batal penjualan");
    expect(html).not.toContain("Belum dibayar");
  });
  it("R4: struk voucher/promo/penggajian sudah dibuat: formulir batalkan penerimaan menerima peringatan; struk biasa tidak; error baca penggajian = tanpa peringatan", async () => {
    expect(await render()).not.toContain("terhalang:");
    state.voucher = "HEMAT10";
    expect(await render()).toContain("terhalang:struk ini memakai voucher");
    state.voucher = null; state.promo = true;
    expect(await render()).toContain("terhalang:struk ini berisi item promo");
    state.promo = false; state.payrollCount = 1;
    expect(await render()).toContain("terhalang:penggajian bulan struk ini sudah dibuat");
    state.payrollError = true;
    expect(await render()).not.toContain("terhalang:");
    state.payrollError = false; state.role = "FINANCE";
    expect(await render()).not.toContain("terhalang:penggajian");
  });
  it("shift asal tertutup diteruskan ke formulir (peringatan laci)", async () => {
    state.shift = "closed";
    expect(await render()).toContain("shift-tertutup");
  });
  it("struk belum dibayar: banner, form Terima pembayaran berisi metode lama, ubah transaksi untuk Owner; tanpa Koreksi metode lama", async () => {
    state.open = true;
    const html = await render();
    expect(html).toContain("Belum dibayar — penerimaan dibatalkan");
    expect(html).toContain("form terima ulang Tunai");
    expect(html).toContain("form batal penjualan");
    expect(html).not.toContain("form batalkan penerimaan");
    expect(html).not.toContain("form koreksi metode");
    expect(html).toContain("Penerimaan dibatalkan (struk belum dibayar)");
    expect(html).toContain("Alasan: Salah metode");
  });
  it("struk yang pernah dibatalkan lalu dibayar lagi: koreksi metode lama disembunyikan (pakai siklus baru), riwayat memuat terima ulang", async () => {
    state.cycle = true;
    const html = await render();
    expect(html).not.toContain("form koreksi metode");
    expect(html).toContain("form batalkan penerimaan");
    expect(html).toContain("Pembayaran diterima ulang");
    expect(html).toContain("Tunai Rp 100.000 → QRIS Rp 100.000");
  });
  it("OWNER: bila hak gagal terbaca, tombol tetap tampil (basis data yang memutuskan, Owner selalu lolos); peran lain tidak", async () => {
    state.allowedError = true;
    expect(await render()).toContain("form batalkan penerimaan");
    state.role = "FINANCE";
    expect(await render()).not.toContain("form batalkan penerimaan");
  });
  it("ADMIN tanpa izin tidak melihat tombol; ADMIN berizin melihat Batalkan penerimaan tetapi bukan Batalkan penjualan", async () => {
    state.role = "ADMIN"; state.allowed = false;
    expect(await render()).not.toContain("form batalkan penerimaan");
    state.allowed = true;
    const html = await render();
    expect(html).toContain("form batalkan penerimaan");
    expect(html).not.toContain("form batal penjualan");
  });
  it("FINANCE berizin pada struk belum dibayar boleh menerima pembayaran ulang tetapi tidak membatalkan penjualan", async () => {
    state.role = "FINANCE"; state.allowed = true; state.open = true;
    const html = await render();
    expect(html).toContain("form terima ulang");
    expect(html).not.toContain("form batal penjualan");
  });
  it("gagal membaca riwayat pembatalan: peringatan, tanpa tombol aksi penerimaan", async () => {
    state.receiptError = true;
    const html = await render();
    expect(html).toContain("Riwayat pembatalan penerimaan belum dapat dibaca");
    expect(html).not.toContain("form batalkan penerimaan");
  });
  it("order marketplace cair: tombol Batalkan pencairan, bukan penerimaan kasir; riwayat pembatalan pencairan", async () => {
    state.channel = "Shopee"; state.marketplace = "cair";
    const html = await render();
    expect(html).toContain("form batalkan pencairan");
    expect(html).not.toContain("form batalkan penerimaan");
    expect(html).toContain("Pencairan marketplace dibatalkan");
  });
  it("order marketplace piutang tanpa pencairan: tidak ada tombol pencairan", async () => {
    state.channel = "Shopee"; state.marketplace = "piutang";
    expect(await render()).not.toContain("form batalkan pencairan");
  });
  it("struk yang sudah dibatalkan: tidak ada tombol penerimaan", async () => {
    state.voided = true;
    const html = await render();
    expect(html).not.toContain("form batalkan penerimaan");
    expect(html).not.toContain("form terima ulang");
  });
});
