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
  identity: null as null | { alamat: string | null; telepon: string | null; logo_path: string | null },
  eqs: [] as string[],
  identityThrows: false, splitBranches: false,
}));
const KOP_BRANCH = "3c9fa638-c99d-4bb7-925b-e28b6bdb4564";
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-kamo-operational-branch": "selected-west" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); } }));
vi.mock("@/components/PrintButton", () => ({ PrintButton: () => null, AutoPrint: () => null }));
vi.mock("@/components/ClearKasirDraft", () => ({ ClearKasirDraft: () => null }));
vi.mock("@/components/ClearPosDraft", () => ({ ClearPosDraft: () => null }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/PrintButton", () => ({ PrintButton: () => null }));
vi.mock("@/lib/rombongan-server", () => ({ bacaRombongan: async () => ({ tanggal: "2026-10-23", customerName: "Pelanggan Uji", baris: [{ visitId: "visit", hewan: "Pasien Uji", invoiceNo: state.requested[0] ?? null, invoiceNos: state.requested, total: 111000, dibayar: 111000, paidStatus: "Lunas" }] }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  storage: { from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/sign/${path}?token=t` }, error: null }) }) },
  from(table: string) {
    const branch = { name: state.name, code: state.code };
    const branches = state.array ? [branch] : branch;
    const invoice = { id: "invoice", invoice_no: "INV-001", no_faktur: "FJ-001", branch_id: "saved-east", branches,
      visits: { branch_id: state.nullInvoiceBranch ? null : KOP_BRANCH, branches: state.nullInvoiceBranch ? null : branches }, order_id: null, total: 111000, subtotal: 100000, dpp: 100000, ppn: 11000, tax: 11000,
      discount: 0, carried_paid: 0, dp_amount: 0, paid_status: "Lunas", status: "lunas", created_at: "2026-10-23T00:00:00Z",
      cashier_name: "Kasir Uji", customers: { name: "Pelanggan Uji" }, revision: 1 };
    const sale = { ...invoice, no_struk: "POS-001", metode_bayar: "Tunai", bayar: 111000, kembali: 0,
      poin_earned: 0, poin_digunakan: 0, sale_payments: [], payment_plan: null, payments_finalized_at: null };
    const data = table === "clinic_payment_receipts" ? { ...invoice, branch_id: KOP_BRANCH, no_kwitansi: "KW-001", visit_id: "visit", clinic_payment_receipt_parts: [{ urutan: 1, metode: "Tunai", amount: 111000 }] } : table === "sales" ? sale : table === "invoices" || table === "sales_invoices" ? invoice
      : table === "visits" ? { id: "visit", branch_id: "visit-context-branch", pets: { name: "Pasien Uji" }, customers: { name: "Pelanggan Uji" }, branches: { name: "Cabang Kunjungan Salah", code: "WRONG" } }
      : table === "branches" ? (() => { if (state.identityThrows) throw new Error("boom"); return state.identity; })()
      : table === "company_settings" ? { ppn_rate: 11, nama_perusahaan: "Perusahaan Bukan Cabang" }
      : table === "clinic_demo_invoice_snapshots" ? null : [];
    const invoiceRows = state.invoiceResult !== undefined ? state.invoiceResult?.map(invoice_no => ({ ...invoice, id: invoice_no, invoice_no, visits: state.splitBranches && invoice_no === "INV-002" ? { branch_id: "other-branch-id", branches: { name: "Cabang Lain", code: "LAIN" } } : invoice.visits })) ?? null : [invoice];
    const clinicItems = (invoiceRows ?? []).map(inv => ({ id: `line-${inv.id}`, invoice_id: inv.id, deskripsi: "Saved clinic service", qty: 1, harga: 100000, diskon_persen: 0 }));
    let from = 0, to = Number.MAX_SAFE_INTEGER, exact = false;
    const q = { select: (s: string, options?: { count?: string }) => { exact = options?.count === "exact"; state.selects.push(`${table}:${s}`); return q; }, eq: (c: string, v: string) => { state.eqs.push(`${table}.${c}=${v}`); return q; }, is: () => q,
      in: () => q, order: () => q, limit: () => q, range: (start: number, end: number) => { from = start; to = end; return q; }, maybeSingle: async () => ({ data, error: null, count: 1 }),
      then: (resolve: (r: unknown) => unknown) => {
        const rows = table === "invoice_items" ? clinicItems : table === "invoices" ? invoiceRows : table === "sales_invoices" ? [invoice] : table === "visits" ? [] : data;
        return Promise.resolve({ data: Array.isArray(rows) ? rows.slice(from, to + 1) : rows, error: table === "invoices" && state.invoiceError ? { message: "read failed" } : null, count: exact && Array.isArray(rows) ? rows.length : null }).then(resolve);
      } };
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
beforeEach(() => { state.name = "Cabang Timur"; state.code = "TMR"; state.array = false; state.selects = []; state.requested = ["INV-001"]; state.invoiceResult = undefined; state.invoiceError = false; state.nullInvoiceBranch = false; state.identity = null; state.eqs = []; state.identityThrows = false; state.splitBranches = false; });
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
      expect(state.selects.some(s => s.startsWith("invoices:") && /visits\((branch_id, )?branches\(name, code\)\)/.test(s))).toBe(true);
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

const IDN = { alamat: "Jl. Raya Cimanggu 12, Bogor", telepon: "0251 8888", logo_path: `cabang-logo/${KOP_BRANCH}/1700000000000-ab12cd34.png` };
const kopIni = (markup: string) => markup.includes('data-kop="cabang"');

const termalKlinik = [
  ["struk klinik", () => ClinicThermal({ params: Promise.resolve({ visitId: "visit" }) })],
  ["struk gabungan klinik", () => GroupReceipt({ params: Promise.resolve({ visitId: "visit" }) })],
  ["kwitansi rawat inap", () => Inpatient({ params: Promise.resolve({ id: "stay", receiptId: "receipt" }) })],
] as const;
const termalPetshop = [
  () => Backoffice({ params: Promise.resolve({ saleId: "sale" }) }),
  () => Cashier({ params: Promise.resolve({ saleId: "sale" }), searchParams: Promise.resolve({}) }),
] as const;

it("invoice klinik memakai kop identitas cabang PENERBIT invoice (logo+alamat+telepon)", async () => {
  state.identity = IDN;
  const inv = renderToStaticMarkup(await ClinicFormal({ params: Promise.resolve({ visitId: "visit" }), searchParams: Promise.resolve({}) }));
  expect(kopIni(inv)).toBe(true);
  expect(inv).toContain("Jl. Raya Cimanggu 12, Bogor · Telp. 0251 8888");
  expect(inv).toContain(`src="https://storage.test/sign/cabang-logo/${KOP_BRANCH}/1700000000000-ab12cd34.png?token=t"`);
  expect(state.eqs).toContain(`branches.id=${KOP_BRANCH}`);
});

it.each(termalKlinik)("%s termal klinik: nama cabang + baris alamat/telepon milik cabang PENERBIT, tanpa logo, bukan cabang terpilih", async (nama, render) => {
  state.identity = IDN;
  const out = renderToStaticMarkup(await render());
  expect(out).toContain("data-kop-struk");
  expect(out).toContain("Jl. Raya Cimanggu 12, Bogor · Telp. 0251 8888");
  expect(kopIni(out)).toBe(false);
  expect(out).not.toContain("<img");
  expect(out).not.toContain("storage.test");
  expect(out).not.toContain("selected-west");
  expect(state.eqs).toContain(`branches.id=${KOP_BRANCH}`);
  expect(state.eqs.some((e) => e === "branches.id=selected-west" || e === "branches.id=saved-east")).toBe(false);
  expect(paper(out).textContent?.trim().startsWith("Cabang Timur")).toBe(true);
  if (nama === "kwitansi rawat inap") {
    expect(out.indexOf("Jl. Raya Cimanggu")).toBeGreaterThan(-1);
    expect(out.indexOf("Jl. Raya Cimanggu")).toBeLessThan(out.indexOf("KWITANSI PEMBAYARAN"));
  }
});

it.each(termalKlinik)("%s termal klinik: hanya alamat / hanya telepon / belum diisi / gagal baca = baris kecil menyesuaikan, tidak pernah gagal cetak", async (_n, render) => {
  state.identity = { alamat: "Jl. Raya Cimanggu 12, Bogor", telepon: null, logo_path: null };
  let out = renderToStaticMarkup(await render());
  expect(out).toContain(">Jl. Raya Cimanggu 12, Bogor<");
  expect(out).not.toContain("Telp.");
  state.identity = { alamat: null, telepon: "0251 8888", logo_path: null };
  out = renderToStaticMarkup(await render());
  expect(out).toContain(">Telp. 0251 8888<");
  state.identity = { alamat: null, telepon: null, logo_path: null };
  out = renderToStaticMarkup(await render());
  expect(out).not.toContain("data-kop-struk-kontak");
  expect(out).toContain("Cabang Timur");
  state.identityThrows = true; state.identity = IDN;
  out = renderToStaticMarkup(await render());
  expect(out).not.toContain("data-kop-struk-kontak");
  expect(out).toContain("Cabang Timur");
  expect(out).toContain("Rp 111.000");
});

it("struk klinik / kwitansi dengan cabang penerbit tidak tercatat: 'Cabang belum tercatat' dan tidak membaca identitas sama sekali", async () => {
  state.nullInvoiceBranch = true; state.identity = IDN;
  for (const render of [termalKlinik[0][1], termalKlinik[1][1]]) {
    state.eqs = [];
    const out = renderToStaticMarkup(await render());
    expect(out).toContain("Cabang belum tercatat");
    expect(out).not.toContain("data-kop-struk-kontak");
    expect(state.eqs.some((e) => e.startsWith("branches.id="))).toBe(false);
  }
});

it("struk gabungan: tagihan dari BEBERAPA cabang = daftar nama saja, tanpa alamat/telepon; satu cabang = alamat/telepon cabang itu", async () => {
  state.identity = IDN; state.requested = ["INV-001", "INV-002"]; state.invoiceResult = ["INV-001", "INV-002"]; state.splitBranches = true;
  let out = renderToStaticMarkup(await GroupReceipt({ params: Promise.resolve({ visitId: "visit" }) }));
  expect(out).toContain("Cabang Timur · Cabang Lain");
  expect(out).not.toContain("data-kop-struk-kontak");
  expect(state.eqs.some((e) => e.startsWith("branches.id="))).toBe(false);
  state.splitBranches = false;
  out = renderToStaticMarkup(await GroupReceipt({ params: Promise.resolve({ visitId: "visit" }) }));
  expect(out).toContain("Jl. Raya Cimanggu 12, Bogor · Telp. 0251 8888");
  expect(state.eqs).toContain(`branches.id=${KOP_BRANCH}`);
});

it("struk gabungan tanpa tagihan memakai cabang kunjungan acuannya sendiri untuk identitas", async () => {
  state.requested = []; state.identity = IDN;
  const out = renderToStaticMarkup(await GroupReceipt({ params: Promise.resolve({ visitId: "visit" }) }));
  expect(state.eqs).toContain("branches.id=visit-context-branch");
  expect(out).toContain("Jl. Raya Cimanggu 12, Bogor");
});

it("struk petshop (POS back office dan kasir) TIDAK berubah: tanpa kop identitas, tanpa membaca identitas cabang", async () => {
  state.identity = IDN;
  for (const render of termalPetshop) {
    state.eqs = [];
    const out = renderToStaticMarkup(await render());
    expect(kopIni(out)).toBe(false);
    expect(out).not.toContain("data-kop-struk");
    expect(out).not.toContain("Jl. Raya Cimanggu");
    expect(out).not.toContain("storage.test");
    expect(state.eqs.some((e) => e.startsWith("branches.id="))).toBe(false);
  }
});
