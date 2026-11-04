// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "FINANCE", names: true, historyFails: false, tables: [] as string[] }));
const OLD = "00000000-0000-4000-8000-0000000000a1";
const NEW = "00000000-0000-4000-8000-0000000000a2";
const RECEIPT = "00000000-0000-4000-8000-0000000000b1";

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "viewer" } } }) },
  from(table: string) {
    state.tables.push(table);
    const invoiceNew = { id: NEW, no_faktur: "FJ-002", order_id: null, tanggal: "2026-11-02", jatuh_tempo: "2026-12-02", total: 90, dpp: 90, ppn: 0, carried_paid: 0,
      returned_ar: 0, revision: 1, status: "berjalan", voided_on: null, void_reason: null, replaces_invoice_id: OLD, catatan: null, kategori: "penjualan", opening_batch_id: null };
    const invoiceOld = { ...invoiceNew, id: OLD, no_faktur: "FJ-001", status: "batal", voided_on: "2026-11-02", void_reason: "Salah harga", replaces_invoice_id: null };
    const receipt = { id: RECEIPT, invoice_id: OLD, no_terima: "TRM-7", tanggal: "2026-11-01", jumlah: 100, dari_uang_muka: 0, metode: "Transfer", journal_id: null,
      voided_at: "2026-11-02T02:00:00Z", void_reason: "Salah nominal", reversal_of: null, revision: 2, advance_id: null, advance: null };
    const rows: Record<string, unknown[]> = {
      sales_invoices: [invoiceNew, invoiceOld],
      sales_receipts: [receipt],
      wholesale_invoice_corrections: [{ id: "c1", invoice_id: OLD, created_at: "2026-11-02T03:00:00Z", tanggal: "2026-11-02", reason: "Salah harga", created_by: "u-owner",
        paid_preserved: 0, customer_credit: 0, original_journal_id: "aaaaaaaa-1", reversal_journal_id: "bbbbbbbb-2", replacement_journal_id: null, credit_journal_id: null }],
      sales_receipt_cancellations: [{ id: "x1", receipt_id: RECEIPT, invoice_id: OLD, created_at: "2026-11-02T02:00:00Z", tanggal: "2026-11-02", reason: "Salah nominal",
        created_by: "u-fin", advance_restored: 0, original_journal_id: "dddddddd-4", reversal_journal_id: "eeeeeeee-5" }],
      profiles: state.names ? [{ id: "u-owner", full_name: "Rina Owner" }, { id: "u-fin", full_name: "Fajar Finance" }] : [],
    };
    const q: Record<string, unknown> = {};
    for (const name of ["select", "eq", "order", "in", "range"]) q[name] = () => q;
    q.maybeSingle = async () => ({ data: table === "profiles" ? { role: state.role, is_active: true } : table === "company_settings" ? { ppn_rate: 11 } : invoiceNew });
    q.then = (resolve: (value: unknown) => void) => {
      if (state.historyFails && table === "wholesale_invoice_corrections") return resolve({ data: null, count: null, error: { message: "boom" } });
      const data = rows[table] ?? [];
      return resolve({ data, count: data.length, error: null });
    };
    return q;
  },
}) }));
vi.mock("@/app/(app)/penjualan/faktur/[id]/WholesaleCorrectionForm", () => ({ WholesaleCorrectionForm: () => <span>owner correction</span> }));

import Detail from "@/app/(app)/penjualan/faktur/[id]/page";
const render = async () => renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: NEW }), searchParams: Promise.resolve({}) }));

beforeEach(() => { state.role = "FINANCE"; state.names = true; state.historyFails = false; state.tables = []; });

describe("Faktur Penjualan: Riwayat perubahan", () => {
  it("FINANCE melihat garis waktu berisi pelaku bernama, nomor lama → baru, penerimaan yang dihapus dan alasan", async () => {
    const html = await render();
    expect(html).toContain("RIWAYAT PERUBAHAN FAKTUR");
    expect(html).toContain("Rina Owner");
    expect(html).toContain("Fajar Finance");
    expect(html).toContain("FJ-001 → FJ-002");
    expect(html).toContain("Penerimaan dihapus");
    expect(html).toContain("TRM-7");
    expect(html).toContain("Alasan: Salah nominal");
    expect(html).toContain("Alasan: Salah harga");
  });

  it("tidak lagi menyiarkan UUID pelaku atau id jurnal mentah", async () => {
    const html = await render();
    expect(html).not.toContain("u-owner");
    expect(html).not.toContain("u-fin");
    expect(html).not.toContain("aaaaaaaa-1");
  });

  it("ADMIN juga melihat panel; peran lain tetap melihat blok audit lama, tanpa panel baru", async () => {
    state.role = "ADMIN";
    expect(await render()).toContain("RIWAYAT PERUBAHAN FAKTUR");
    state.role = "STAFF";
    const html = await render();
    expect(html).not.toContain("RIWAYAT PERUBAHAN FAKTUR");
    expect(html).toContain("Audit koreksi");
  });

  it("gagal membaca sumber riwayat: peringatan terlihat, bukan daftar kosong", async () => {
    state.historyFails = true;
    const html = await render().catch((e: Error) => e.message);
    expect(html).toMatch(/belum dapat dimuat lengkap|Riwayat koreksi/);
  });

  it("nama tidak terbaca (profil lain tersaring RLS) menjadi 'Pengguna lain' dengan catatan", async () => {
    state.names = false;
    const html = await render();
    expect(html).toContain("Pengguna lain");
    expect(html).toContain("Nama pelaku lain hanya terlihat oleh Owner/Admin");
  });
});
