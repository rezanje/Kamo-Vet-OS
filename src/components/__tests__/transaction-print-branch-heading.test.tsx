// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  name: "Cabang Timur", code: "TMR", array: false, selects: [] as string[],
  requested: ["INV-001"] as string[],
  invoiceResult: undefined as undefined | null | string[],
  invoiceError: false,
  nullInvoiceBranch: false,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-kamo-operational-branch": "selected-west" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); } }));
vi.mock("@/components/PrintButton", () => ({ PrintButton: () => null, AutoPrint: () => null }));
vi.mock("@/components/ClearKasirDraft", () => ({ ClearKasirDraft: () => null }));
vi.mock("@/components/ClearPosDraft", () => ({ ClearPosDraft: () => null }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/PrintButton", () => ({ PrintButton: () => null }));
vi.mock("@/lib/rombongan-server", () => ({ bacaRombongan: async () => ({ tanggal: "2026-10-23", customerName: "Pelanggan Uji", baris: [{ visitId: "visit", hewan: "Pasien Uji", invoiceNo: state.requested[0] ?? null, invoiceNos: state.requested, total: 111000, dibayar: 111000, paidStatus: "Lunas" }] }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from(table: string) {
    const branch = { name: state.name, code: state.code };
    const branches = state.array ? [branch] : branch;
    const invoice = { id: "invoice", invoice_no: "INV-001", no_faktur: "FJ-001", branch_id: "saved-east", branches,
      visits: { branches: state.nullInvoiceBranch ? null : branches }, order_id: null, total: 111000, subtotal: 100000, dpp: 100000, ppn: 11000, tax: 11000,
      discount: 0, carried_paid: 0, dp_amount: 0, paid_status: "Lunas", status: "lunas", created_at: "2026-10-23T00:00:00Z",
      cashier_name: "Kasir Uji", customers: { name: "Pelanggan Uji" }, revision: 1 };
    const sale = { ...invoice, no_struk: "POS-001", metode_bayar: "Tunai", bayar: 111000, kembali: 0,
      poin_earned: 0, poin_digunakan: 0, sale_payments: [], payment_plan: null, payments_finalized_at: null };
    const data = table === "clinic_payment_receipts" ? { ...invoice, no_kwitansi: "KW-001", visit_id: "visit", clinic_payment_receipt_parts: [{ urutan: 1, metode: "Tunai", amount: 111000 }] } : table === "sales" ? sale : table === "invoices" || table === "sales_invoices" ? invoice
      : table === "visits" ? { id: "visit", pets: { name: "Pasien Uji" }, customers: { name: "Pelanggan Uji" }, branches: { name: "Cabang Kunjungan Salah", code: "WRONG" } }
      : table === "company_settings" ? { ppn_rate: 11, nama_perusahaan: "Perusahaan Bukan Cabang" }
      : table === "clinic_demo_invoice_snapshots" ? null : [];
    const q = { select: (s: string) => { state.selects.push(`${table}:${s}`); return q; }, eq: () => q, is: () => q,
      in: () => q, order: () => q, limit: () => q, range: () => q, maybeSingle: async () => ({ data, error: null, count: 1 }),
      then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data: table === "invoices" && state.invoiceResult !== undefined ? state.invoiceResult?.map(invoice_no => ({ ...invoice, id: invoice_no, invoice_no })) ?? null : table === "sales_invoices" || table === "invoices" ? [invoice] : table === "visits" ? [] : data, error: table === "invoices" && state.invoiceError ? { message: "read failed" } : null, count: table === "sales_invoices" ? 1 : 0 }).then(resolve) };
    return q;
  },
}) }));
import Cashier from "@/app/kasir/struk/[saleId]/page";
import Backoffice from "@/app/(app)/pos/struk/[saleId]/page";
it("02-pos uses the saved issuing relation for the primary heading", async () => {
  await check(() => Backoffice({ params: Promise.resolve({ saleId: "sale" }) }), "POS-001");
});

import ClinicThermal from "@/app/(app)/klinik/pembayaran/[visitId]/struk/page";
it("03-clinic-thermal uses the saved issuing relation for the primary heading", async () => {
  await check(() => ClinicThermal({ params: Promise.resolve({ visitId: "visit" }) }), "INV-001");
});

import ClinicFormal from "@/app/(app)/klinik/pembayaran/[visitId]/invoice/page";
it("04-clinic-formal uses the saved issuing relation for the primary heading", async () => {
  await check(() => ClinicFormal({ params: Promise.resolve({ visitId: "visit" }), searchParams: Promise.resolve({}) }), "INV-001");
});

import Wholesale from "@/app/(app)/penjualan/faktur/[id]/page";
it("05-wholesale prints its saved branch heading", async () => {
  await check(() => Wholesale({ params: Promise.resolve({ id: "invoice" }), searchParams: Promise.resolve({}) }), "FJ-001");
});

import Inpatient from "@/app/(app)/klinik/rawat-inap/[id]/tagihan/kwitansi/[receiptId]/page";
it("06-inpatient prints its saved branch heading", async () => { await check(() => Inpatient({ params: Promise.resolve({ id: "stay", receiptId: "receipt" }) }), "KW-001"); });

import GroupReceipt from "@/app/(app)/klinik/pembayaran/[visitId]/struk-rombongan/page";
it("07-group uses invoice issuing relations rather than the context visit", async () => { await check(() => GroupReceipt({ params: Promise.resolve({ visitId: "visit" }) }), "INV-001"); });

const paper = (markup: string) => {
  const doc = new DOMParser().parseFromString(markup, "text/html");
  doc.querySelectorAll("style,script,.no-print").forEach(el => el.remove());
  return doc.body;
};
beforeEach(() => { state.name = "Cabang Timur"; state.code = "TMR"; state.array = false; state.selects = []; state.requested = ["INV-001"]; state.invoiceResult = undefined; state.invoiceError = false; state.nullInvoiceBranch = false; });
async function check(render: () => Promise<React.ReactNode>, invoiceCode: string) {
  for (const [name, code, array] of [["Cabang Timur", "TMR", false], ["Cabang Barat", "BRT", true], ["  ", "LEGACY", false]] as const) {
    Object.assign(state, { name, code, array });
    const body = paper(renderToStaticMarkup(await render()));
    const expected = name.trim() || code;
    expect((body.querySelector(".crm-sec") ?? body).textContent?.trim().startsWith(expected)).toBe(true);
    expect(body.textContent).not.toMatch(/KAMO PET CARE|KAMO PETSHOP|Cabang Kunjungan Salah|Perusahaan Bukan Cabang|selected-west/);
    for (const text of [invoiceCode, "Pelanggan Uji", "Rp 111.000"]) expect(body.textContent).toContain(text);
    if (invoiceCode === "INV-001") {
      expect(body.textContent).toContain("Rp 11.000");
      expect(state.selects.some(s => s.startsWith("invoices:") && s.includes("visits(branches(name, code))"))).toBe(true);
    }
    if (invoiceCode === "FJ-001") expect(state.selects.some(s => s.startsWith("sales_invoices:") && s.includes("branches(name, code)"))).toBe(true);
  }
}
it("cashier thermal heading uses its saved sale branch, not selected context", async () => {
  await check(() => Cashier({ params: Promise.resolve({ saleId: "sale" }), searchParams: Promise.resolve({}) }), "POS-001");
  expect(state.selects.some(s => s.startsWith("sales:") && s.includes("branches(name, code)"))).toBe(true);
});

it.each([
  { label: "query error even with complete rows", requested: ["INV-001"], rows: ["INV-001"], error: true },
  { label: "null rows", requested: ["INV-001"], rows: null, error: false },
  { label: "empty rows", requested: ["INV-001"], rows: [], error: false },
  { label: "partial/truncated rows", requested: ["INV-001", "INV-002"], rows: ["INV-001"], error: false },
  { label: "unexpected replacement row", requested: ["INV-001"], rows: ["INV-999"], error: false },
  { label: "unexpected extra row", requested: ["INV-001"], rows: ["INV-001", "INV-999"], error: false },
  { label: "duplicate row hiding a missing invoice", requested: ["INV-001", "INV-002"], rows: ["INV-001", "INV-001"], error: false },
  { label: "duplicate extra row", requested: ["INV-001"], rows: ["INV-001", "INV-001"], error: false },
])("group withholds printable output for $label", async ({ requested, rows, error }) => {
  state.requested = requested;
  state.invoiceResult = rows;
  state.invoiceError = error;
  await expect(GroupReceipt({ params: Promise.resolve({ visitId: "visit" }) })).rejects.toThrow(/verifikasi.*tagihan/i);
});

it("group accepts the complete distinct requested set in any result order", async () => {
  state.requested = ["INV-001", "INV-002", "INV-001"];
  state.invoiceResult = ["INV-002", "INV-001"];
  const body = paper(renderToStaticMarkup(await GroupReceipt({ params: Promise.resolve({ visitId: "visit" }) })));
  expect(body.textContent).toContain("Cabang Timur");
  expect(body.textContent).toContain("INV-002");
  expect(body.textContent).not.toContain("Cabang Kunjungan Salah");
});

it("group with no requested invoice legitimately uses the context visit branch", async () => {
  state.requested = [];
  state.invoiceError = true;
  const body = paper(renderToStaticMarkup(await GroupReceipt({ params: Promise.resolve({ visitId: "visit" }) })));
  expect(body.textContent?.trim().startsWith("Cabang Kunjungan Salah")).toBe(true);
  expect(body.textContent).toContain("tagihan belum dibuat");
  expect(state.selects.some(s => s.startsWith("invoices:"))).toBe(false);
});

it("group confirmed invoice with a null branch prints explicit missing branch, not context", async () => {
  state.nullInvoiceBranch = true;
  const body = paper(renderToStaticMarkup(await GroupReceipt({ params: Promise.resolve({ visitId: "visit" }) })));
  expect(body.textContent).toContain("Cabang belum tercatat");
  expect(body.textContent).not.toContain("Cabang Kunjungan Salah");
  expect(body.textContent).not.toContain("tagihan belum dibuat");
});
