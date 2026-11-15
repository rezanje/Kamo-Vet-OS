// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "OWNER", correctionsFail: false, voided: false, names: true }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
vi.mock("@/components/dokumen/DokumenPanel", () => ({ DokumenPanel: () => null }));
vi.mock("@/app/(app)/penjualan/[id]/SaleCancelForm", () => ({ SaleCancelForm: () => <span>form batal</span> }));
vi.mock("@/app/(app)/penjualan/[id]/SalePaymentCorrectionForm", () => ({ SalePaymentCorrectionForm: () => <span>form koreksi</span> }));
vi.mock("@/app/(app)/penjualan/[id]/SaleReceiptForms", () => ({ SaleReceiptCancelForm: () => <span>form batalkan penerimaan</span>, SaleReceiveAgainForm: () => null, OnlineDisbursementCancelForm: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "viewer" } } }) },
  rpc: async () => ({ data: state.role === "OWNER", error: null }),
  from(table: string) {
    const sale = { id: "sale", revision: 3, channel: null, void_reason: state.voided ? "Dobel scan" : null, no_struk: "S-100", created_at: "2026-11-01T01:00:00Z",
      subtotal: 100000, discount: 0, total: 100000, merchant_fee_total: 0, metode_bayar: "Transfer", bayar: 100000, kembali: 0, payment_plan: [], payments_finalized_at: "2026-11-01T01:00:00Z",
      voided_at: state.voided ? "2026-11-03T08:00:00Z" : null, sale_payments: [{ method: "Transfer", amount: 100000, fee_amount: 0, fee_percent: 0 }],
      branches: { name: "A" }, customers: null, kasir: { full_name: "Kasir" }, sale_items: [] };
    const lists: Record<string, unknown[]> = {
      sales_returns: [{ id: "t1", no_retur: "RT-1", tanggal: "2026-11-01", total: 20000, voided_at: null, sales_return_items: [] }],
      sale_payment_corrections: [{ id: "p1", revision: 1, reason: "Salah metode", created_at: "2026-11-02T08:00:00Z", created_by: "u-fin",
        before_payments: [{ method: "Tunai", amount: 100000 }], after_payments: [{ method: "Transfer", amount: 100000 }] }],
      profiles: state.names ? [{ id: "u-fin", full_name: "Fajar Finance" }, { id: "u-owner", full_name: "Rina Owner" }] : [],
    };
    const q: Record<string, unknown> = {};
    for (const name of ["select", "eq", "order", "in", "limit"]) q[name] = () => q;
    q.maybeSingle = async () => ({ data: table === "profiles" ? { role: state.role, is_active: true }
      : table === "sales" ? sale
      : table === "sale_cancellations" ? (state.voided ? { id: "z1", reason: "Dobel scan", created_at: "2026-11-03T08:00:00Z", created_by: "u-owner" } : null) : null, error: null });
    q.then = (resolve: (value: unknown) => void) => resolve(table === "sale_payment_corrections" && state.correctionsFail
      ? { data: null, error: { message: "boom" } } : { data: lists[table] ?? [], error: null });
    return q;
  },
}) }));

import PenjualanDetailPage from "@/app/(app)/penjualan/[id]/page";
const render = async () => renderToStaticMarkup(await PenjualanDetailPage({ params: Promise.resolve({ id: "sale" }), searchParams: Promise.resolve({}) }));

beforeEach(() => { state.role = "OWNER"; state.correctionsFail = false; state.voided = false; state.names = true; });

describe("Penjualan petshop: Riwayat perubahan", () => {
  it("OWNER melihat koreksi metode bernama pelaku, retur, dan pembatalan dengan alasan", async () => {
    state.voided = true;
    const html = await render();
    expect(html).toContain("RIWAYAT PERUBAHAN TRANSAKSI");
    expect(html).toContain("Fajar Finance");
    expect(html).toContain("Tunai Rp 100.000 → Transfer Rp 100.000");
    expect(html).toContain("Penjualan dibatalkan");
    expect(html).toContain("Rina Owner");
    expect(html).toContain("Alasan: Dobel scan");
    expect(html).toContain("RT-1");
  });

  it("FINANCE melihat panel; ADMIN melihat panel dengan catatan bahwa koreksi metode hanya terlihat Owner/Finance", async () => {
    state.role = "FINANCE";
    expect(await render()).toContain("RIWAYAT PERUBAHAN TRANSAKSI");
    state.role = "ADMIN";
    const html = await render();
    expect(html).toContain("RIWAYAT PERUBAHAN TRANSAKSI");
    expect(html).toContain("Koreksi metode bayar hanya terlihat oleh Owner dan Finance");
    expect(html).not.toContain("Salah metode");
  });

  it("peran lain tidak melihat panel", async () => {
    state.role = "KASIR";
    expect(await render()).not.toContain("RIWAYAT PERUBAHAN TRANSAKSI");
  });

  it("gagal membaca koreksi: peringatan, bukan 'belum ada perubahan'", async () => {
    state.correctionsFail = true;
    const html = await render();
    expect(html).toContain("belum dapat dimuat lengkap");
    expect(html).not.toContain("Belum ada perubahan tercatat");
  });

  it("tidak menampilkan UUID pelaku", async () => {
    state.names = false;
    const html = await render();
    expect(html).not.toContain("u-fin");
    expect(html).toContain("Pengguna lain");
  });
});
