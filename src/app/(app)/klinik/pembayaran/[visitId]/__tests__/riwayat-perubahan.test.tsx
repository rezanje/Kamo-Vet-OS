// Riwayat perubahan transaksi klinik: satu garis waktu dari log edit, terbit ulang, koreksi metode, refund dan batal kwitansi.
// Mock memakai bentuk baris yang sama dengan tabel aslinya; peran dan profil diatur per kasus.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "FINANCE", namesVisible: true, receiptsFail: false, tables: [] as string[] }));

const invoiceBase = { subtotal: 100000, discount: 0, tax: 0, total: 100000, dp_amount: 0, dp_date: null, paid_status: "Belum Lunas", metode_bayar: "Tunai", paid_at: null,
  correction_pending: false, request_key: "k", salesperson_id: null, cashier_name: "Kasir", service_pricing_version: null };

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "viewer" } } }) },
  rpc: async (name: string) => ({ data: name === "clinic_invoice_correction_eligible" ? false : false, error: null }),
  from(table: string) {
    state.tables.push(table);
    let single = false; let selected = ""; let inUsed = false; let eqTable = false;
    const q: Record<string, unknown> = { then: (resolve: (v: unknown) => void) => {
      let data: unknown = [];
      if (table === "visits") data = { id: "visit", status: "Pembayaran", poli: "Umum", created_at: "2026-11-03T00:00:00Z", branch_id: "branch", pets: { name: "Pasien Fiktif" }, customers: { name: "Pemilik Fiktif" } };
      if (table === "medical_records") data = { id: "mr" };
      if (table === "inpatient_records") data = null;
      if (table === "profiles") data = inUsed
        ? (state.namesVisible ? [{ id: "u-owner", full_name: "Rina Owner" }, { id: "u-fin", full_name: "Fajar Finance" }] : [])
        : { role: state.role, is_active: true };
      if (table === "invoices") data = selected.includes("subtotal")
        ? [{ ...invoiceBase, id: "i2", invoice_no: "INV-2", reissued_from: "i1", created_at: "2026-11-03T04:00:05Z" }]
        : [{ id: "i1", invoice_no: "INV-1", reissued_from: null, created_at: "2026-11-01T01:00:00Z", voided_at: "2026-11-03T04:00:00Z" },
           { id: "i2", invoice_no: "INV-2", reissued_from: "i1", created_at: "2026-11-03T04:00:05Z", voided_at: null }];
      if (table === "invoice_items") data = [{ id: "baris", deskripsi: "Jasa Fiktif", qty: 1, harga: 100000, jenis: "jasa", item_id: null, diskon_persen: 0, compound_recipe_id: null, prescription_item_id: null, satuan: "kali" }];
      if (table === "invoice_edit_log") data = [
        { id: "e1", invoice_id: "i2", field_changed: "diskon", old_value: "0", new_value: "10", reason: "Promo lupa", edited_at: "2026-11-03T05:00:00Z", edited_by: "u-owner", profiles: null },
        { id: "e2", invoice_id: "i1", field_changed: "voided", old_value: null, new_value: "true", reason: "Salah item", edited_at: "2026-11-03T04:00:00Z", edited_by: "u-fin", profiles: null }];
      if (table === "clinic_payment_corrections") data = [{ id: "k1", invoice_id: "i1", revision: 1, amount: 50000, from_method: "Tunai", to_method: "Transfer", reason: "Salah metode", created_at: "2026-11-02T08:00:00Z", created_by: "u-fin" }];
      if (table === "clinic_refunds") data = [{ id: "f1", no_refund: "RF-1", tanggal: "2026-11-04", total: 25000, method: "Tunai", keterangan: "Obat kembali", created_at: "2026-11-04T02:00:00Z", created_by: "u-owner" }];
      if (table === "clinic_payment_receipts") data = [{ id: "q1", no_kwitansi: "KW-1", total: 300000, status: "batal", void_reason: "Salah nominal", voided_at: "2026-11-02T01:00:00Z", voided_by: "u-fin" }];
      if (["clinic_demo_invoice_snapshots"].includes(table)) data = null;
      if (["invoice_payments", "prescription_items", "compounding_recipes", "consents"].includes(table)) data = [];
      if (table === "clinic_payment_receipts" && state.receiptsFail) return resolve({ data: null, error: { message: "boom" }, count: null });
      const count = Array.isArray(data) ? data.length : null;
      if (single && Array.isArray(data)) data = (data as unknown[])[0] ?? null;
      resolve({ data, error: null, count });
    } };
    for (const method of ["select", "eq", "gt", "is", "in", "order", "limit", "range", "maybeSingle"]) {
      q[method] = (...args: unknown[]) => {
        if (method === "select") selected = String(args[0]);
        if (method === "in") inUsed = true;
        if (method === "eq") eqTable = !eqTable;
        if (method === "maybeSingle") single = true;
        return q;
      };
    }
    return q;
  },
}) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); }, redirect: (url: string) => { throw Error(url); } }));
vi.mock("@/lib/service-performers-server", () => ({ loadServiceStaff: async () => [], loadBranchGroomingPolicy: async () => null, loggedInCashier: async () => ({ employeeId: null, name: "Kasir Fiktif" }) }));
vi.mock("@/lib/clinic-demo-policy-server", () => ({ readDemoPolicy: async () => null }));
vi.mock("@/lib/clinic-payment", () => ({ loadClinicPaymentMaster: async () => ({ obat: [], jasa: [], all: [] }), loadClinicPackages: async () => [] }));
vi.mock("@/lib/penjual", () => ({ daftarPenjual: async () => [] }));
vi.mock("@/lib/master-guard", () => ({ bolehTransaksiKas: async () => false }));
vi.mock("@/components/PilihRekening", () => ({ loadRekeningAktif: async () => [], PilihRekening: () => null }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift" }) }));
vi.mock("@/lib/pajak", () => ({ getPajakSettings: async () => ({ mode_pkp: false, ppn_rate: 0 }) }));
vi.mock("@/lib/tindakan", () => ({ bolehBayar: () => true, kategoriBerisiko: () => [] }));
vi.mock("@/lib/consent-server", () => ({ bacaAturanConsent: async () => [] }));
vi.mock("@/lib/rombongan-server", () => ({ bacaRombongan: async () => null }));
vi.mock("@/lib/tagihan-klinik", () => ({ perkiraanTagihan: async () => new Map(), bekalPotonganKlinik: async () => ({}), nilaiBaris: (r: { qty: number; harga: number }) => r.qty * r.harga }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm", () => ({
  PembayaranForm: (props: { editMode?: boolean; initialDpAmount?: number; initialCreditAmount?: number }) =>
    <div data-form-koreksi={props.editMode ? "1" : "0"} data-dp={props.initialDpAmount} data-kredit={props.initialCreditAmount}>FORM</div>,
}));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/LunasiRombonganForm", () => ({ LunasiRombonganForm: () => null }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/VoidReissueForm", () => ({ VoidReissueForm: () => null }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/ClinicRefundPanel", () => ({ ClinicRefundPanel: () => null, loadClinicRefundData: async () => null }));
import Page from "@/app/(app)/klinik/pembayaran/[visitId]/page";
const render = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ visitId: "visit" }), searchParams: Promise.resolve({ invoice_id: "i2" }) }));

beforeEach(() => { state.role = "FINANCE"; state.namesVisible = true; state.receiptsFail = false; state.tables = []; });

describe("Klinik pembayaran: Riwayat perubahan transaksi", () => {
  it("FINANCE melihat garis waktu lengkap dengan pelaku bernama", async () => {
    const html = await render();
    expect(html).toContain("RIWAYAT PERUBAHAN TRANSAKSI");
    for (const text of ["Rina Owner", "Fajar Finance", "diskon: 0 → 10", "INV-1 → INV-2", "Koreksi metode bayar (revisi 1)", "Tunai → Transfer",
      "RF-1", "Kwitansi dibatalkan", "KW-1", "Alasan: Promo lupa", "Alasan: Salah nominal"]) expect(html).toContain(text);
  });

  it("OWNER dan ADMIN juga melihat panel; STAFF/DOCTOR tetap melihat tabel lama tanpa panel baru", async () => {
    state.role = "OWNER";
    expect(await render()).toContain("RIWAYAT PERUBAHAN TRANSAKSI");
    state.role = "ADMIN";
    expect(await render()).toContain("RIWAYAT PERUBAHAN TRANSAKSI");
    for (const role of ["STAFF", "DOCTOR"]) {
      state.role = role;
      const html = await render();
      expect(html).not.toContain("RIWAYAT PERUBAHAN TRANSAKSI");
      expect(html).toContain("RIWAYAT PERUBAHAN INVOICE");
    }
  });

  it("tidak membocorkan UUID pelaku; nama yang tersaring RLS menjadi 'Pengguna lain'", async () => {
    state.namesVisible = false;
    const html = await render();
    expect(html).not.toContain("u-owner");
    expect(html).not.toContain("u-fin");
    expect(html).toContain("Pengguna lain");
    expect(html).toContain("Nama pelaku lain hanya terlihat oleh Owner/Admin");
  });

  it("sumber gagal dibaca: peringatan terlihat, bukan daftar kosong", async () => {
    state.receiptsFail = true;
    const html = await render();
    expect(html).toContain("belum dapat dimuat lengkap");
    expect(html).not.toContain("Belum ada perubahan tercatat");
  });

  it("pembacaan tambahan hanya terjadi untuk peran yang boleh melihat panel", async () => {
    state.role = "STAFF";
    await render();
    expect(state.tables).not.toContain("clinic_refunds");
    expect(state.tables).not.toContain("clinic_payment_receipts");
  });
});
