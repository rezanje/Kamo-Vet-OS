import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { PackagePrintSource } from "@/lib/clinic-package-print";
type Item = PackagePrintSource & { id: string; invoice_id: string; jenis?: string; item_id?: string };
const state = vi.hoisted(() => ({
  fail: false, missingName: false, mode: "complete", items: [] as Item[],
  subtotal: 305000 as number | null, secondInvoice: false, invoiceDiscount: 0, invoiceTax: 0,
  selections: [] as string[], reads: [] as { from: number; to: number; exact: boolean; orders: string[] }[],
}));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); } }));
vi.mock("@/lib/rombongan-server", () => ({ bacaRombongan: async () => ({ tanggal: "2026-11-02", customerName: "Pemilik fiksi", baris: [{ visitId: "visit", invoiceNo: "INV-FIKSI", invoiceNos: state.secondInvoice ? ["INV-FIKSI", "INV-SECOND"] : ["INV-FIKSI"], hewan: "Pasien fiksi", paidStatus: "Lunas", total: state.subtotal, dibayar: state.subtotal }] }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from(table: string) {
  const invoice = { id: "invoice", invoice_no: "INV-FIKSI", subtotal: state.subtotal, discount: state.invoiceDiscount, tax: state.invoiceTax, total: Number(state.subtotal) - state.invoiceDiscount + state.invoiceTax, dp_amount: 0, paid_status: "Lunas", metode_bayar: "Tunai", created_at: "2026-11-02T00:00:00Z", cashier_name: "Kasir fiksi" };
  const visit = { id: "visit", poli: "Klinik", doctor_id: null, dokter: "Dokter fiksi", pets: { name: "Pasien fiksi", species: "Kucing" }, customers: { name: "Pemilik fiksi" }, branches: { name: "Cabang fiksi" } };
  let from = 0, to = Number.MAX_SAFE_INTEGER, exact = false;
  const filters: Record<string, unknown> = {}, orders: string[] = [];
  const q = {
    select: (columns: string, options?: { count?: string }) => { if (table === "invoice_items") state.selections.push(columns); exact = options?.count === "exact"; return q; },
    eq: (key: string, value: unknown) => { filters[key] = value; return q; }, is: () => q,
    in: (key: string, values: string[]) => { filters[key] = values; return q; },
    order: (key: string) => { orders.push(key); return q; }, limit: () => q,
    range: (start: number, end: number) => { from = start; to = end; return q; },
    maybeSingle: async () => ({ data: table === "visits" ? visit : table === "invoices" ? invoice : null, error: null, count: 1 }),
    then: (resolve: (r: unknown) => unknown) => {
      let data: unknown[] = table === "invoice_items" ? state.items.map(item => ({ ...item, package: state.missingName && item.package_item_id ? null : item.package })) : table === "invoices" ? [invoice, ...(state.secondInvoice ? [{ ...invoice, id: "second", invoice_no: "INV-SECOND", subtotal: 200000, total: 200000 }] : [])] : table === "visits" ? [visit] : [];
      if (table === "invoice_items" && filters.invoice_id) data = data.filter(item => Array.isArray(filters.invoice_id) ? filters.invoice_id.includes((item as Item).invoice_id) : (item as Item).invoice_id === filters.invoice_id);
      const count = data.length;
      data = data.slice(from, to + 1);
      if (table === "invoice_items") {
        state.reads.push({ from, to, exact, orders: [...orders] });
        if (state.mode === "truncated") data = data.slice(0, 1);
        if (state.mode === "short-last" && from > 0) data = [];
        if (state.mode === "duplicate-last" && from > 0) data = [{ ...state.items[0] }];
      }
      return Promise.resolve({ data: state.mode === "null" && table === "invoice_items" ? null : data, error: state.fail && table === "invoice_items" ? { message: "read failed" } : null,
        count: !exact || (state.mode === "unknown" && table === "invoice_items") ? null : count + (state.mode === "inconsistent-count" || (state.mode === "changed-count" && from > 0) ? 1 : 0) }).then(resolve);
    },
  };
  return q;
} }) }));
import Struk from "@/app/(app)/klinik/pembayaran/[visitId]/struk/page";
import Invoice from "@/app/(app)/klinik/pembayaran/[visitId]/invoice/page";
import Rombongan from "@/app/(app)/klinik/pembayaran/[visitId]/struk-rombongan/page";
const pages = [["thermal", Struk], ["invoice", Invoice], ["rombongan", Rombongan]] as const;
beforeEach(() => {
  Object.assign(state, { fail: false, missingName: false, mode: "complete", subtotal: 305000, secondInvoice: false, invoiceDiscount: 0, invoiceTax: 0, selections: [], reads: [] });
  const origin = { invoice_id: "invoice", package_item_id: "package", package_qty: 1, package: { name: "Paket Steril" } };
  state.items = [
    { ...origin, id: "material-1", item_id: "same-sku", deskripsi: "BMHP spuit internal", qty: 2, harga: 5000, jenis: "obat" },
    { ...origin, id: "material-2", deskripsi: "BMHP benang internal", qty: 1, harga: 40000, jenis: "obat" },
    { ...origin, id: "service", deskripsi: "Jasa isi paket internal", qty: 1, harga: 250000, jenis: "jasa" },
    { id: "standalone", invoice_id: "invoice", item_id: "same-sku", deskripsi: "Spuit dijual satuan", qty: 1, harga: 5000, jenis: "obat" },
  ];
});
const render = async (Page: typeof Struk) => renderToStaticMarkup(await Page({ params: Promise.resolve({ visitId: "visit" }) }));
it.each(pages)("%s prints only package name/quantity/price, preserving genuine standalone goods and saved total", async (_, Page) => {
  const html = await render(Page);
  expect(html).toContain("Paket Steril");
  for (const name of ["BMHP spuit internal", "BMHP benang internal", "Jasa isi paket internal"]) expect(html).not.toContain(name);
  expect(html).toContain("Spuit dijual satuan");
  expect(html).toContain("Rp 300.000"); expect(html).toContain("Rp 305.000");
  expect(state.selections[0]).toContain("package:items!invoice_items_package_item_id_fkey(name)");
});
it.each(pages)("%s refuses a failed line read rather than printing a misleading empty invoice", async (_, Page) => {
  state.fail = true; await expect(render(Page)).rejects.toThrow();
});
it.each(pages)("%s refuses missing persisted package-name readback instead of exposing materials or guessing membership", async (_, Page) => {
  state.missingName = true; await expect(render(Page)).rejects.toThrow(/paket/i);
});
it.each(pages)("%s withholds output when an apparently complete list disagrees with the saved subtotal", async (_, Page) => {
  state.items = state.items.slice(0, 1);
  await expect(render(Page)).rejects.toThrow(/subtotal|verifikasi/i);
});
it.each(pages)("%s rejects an unknown saved subtotal rather than coercing it to zero", async (_, Page) => {
  state.subtotal = null; state.items = [];
  await expect(render(Page)).rejects.toThrow(/subtotal|verifikasi/i);
});
it.each(pages)("%s withholds rendered output when a successful exact-count read contains only the first package component", async (_, Page) => {
  state.mode = "truncated";
  await expect(render(Page)).rejects.toThrow(/lengkap|verifikasi/i);
});
it.each(pages)("%s fails closed on unknown counts or null successful data", async (_, Page) => {
  for (const mode of ["unknown", "null", "inconsistent-count"]) {
    state.mode = mode;
    await expect(render(Page)).rejects.toThrow(/lengkap|verifi/i);
  }
});
it.each(pages)("%s reads a complete package across the 500-row page boundary in stable unique order", async (_, Page) => {
  state.items = Array.from({ length: 501 }, (_, index) => ({ ...state.items[0], id: `line-${index}`, qty: 1, harga: index === 500 ? 305000 : 0 }));
  const html = await render(Page);
  expect(html).toContain("Paket Steril"); expect(html).toContain("Rp 305.000");
  if (Page !== Invoice) expect(html).toContain("1 x Rp 305.000");
  expect(html).not.toContain("BMHP spuit internal");
  expect(state.reads).toEqual([
    { from: 0, to: 499, exact: true, orders: ["created_at", "id"] },
    { from: 500, to: 999, exact: true, orders: ["created_at", "id"] },
  ]);
});
it.each(pages)("%s rejects incomplete/changed/overlapping later pages even when the first page succeeded", async (_, Page) => {
  state.items = Array.from({ length: 501 }, (_, index) => ({ ...state.items[0], id: `line-${index}`, qty: 1, harga: index === 500 ? 305000 : 0 }));
  for (const mode of ["short-last", "changed-count", "duplicate-last"]) {
    state.mode = mode;
    await expect(render(Page)).rejects.toThrow(/lengkap|berubah|duplikat/i);
  }
});
it.each(pages)("%s preserves mixed original component discounts rather than comparing gross package price to saved net subtotal", async (_, Page) => {
  state.items[0].diskon_persen = 10;
  state.subtotal = 304000; state.invoiceDiscount = 4000; state.invoiceTax = 33000;
  const html = await render(Page);
  expect(html).toContain("Rp 299.000"); expect(html).toContain("Rp 300.000");
  expect(html).toContain("Spuit dijual satuan");
  if (Page !== Rombongan) expect(html).toContain("Rp 333.000");
  if (Page === Invoice) { expect(html).toContain("Rp 1.000"); expect(html).not.toContain("10%</td>"); }
});
it("combined pagination keeps identical group IDs separate per original invoice, including different package quantities", async () => {
  state.secondInvoice = true;
  state.items.push(...Array.from({ length: 501 }, (_, index) => ({ ...state.items[0], id: `second-${index}`, invoice_id: "second", package_qty: 2, qty: 1, harga: index === 500 ? 200000 : 0 })));
  const html = await render(Rombongan);
  expect(html.match(/<div>Paket Steril<\/div>/g)).toHaveLength(2);
  expect(html).toContain("1 x Rp 300.000"); expect(html).toContain("2 x Rp 100.000");
  expect(html).toContain("INV-FIKSI, INV-SECOND"); expect(state.reads).toHaveLength(2);
});
it("combined rendering checks each invoice subtotal rather than allowing compensating mismatches", async () => {
  state.secondInvoice = true;
  state.items[0].harga = 5500; // +1000 on the first invoice
  state.items.push({ ...state.items[0], id: "second-line", invoice_id: "second", qty: 1, harga: 199000 }); // -1000 on the second
  await expect(render(Rombongan)).rejects.toThrow(/subtotal|verifikasi/i);
});
it.each(pages)("%s prints legitimate source-decimal half cents with conserved per-invoice net and saved totals", async (_, Page) => {
  const component = state.items[0], standalone = state.items[3];
  for (const strings of [false, true]) {
    state.subtotal = 0.12;
    state.items = [{ ...component, qty: 1, harga: 1.15, diskon_persen: 90 },
      { ...standalone, qty: 1, harga: 0 }];
    if (strings) {
      state.subtotal = "0.12" as unknown as number;
      state.items = state.items.map(row => ({ ...row, qty: String(row.qty), harga: String(row.harga),
        diskon_persen: row.diskon_persen == null ? null : String(row.diskon_persen) })) as unknown as Item[];
    }
    const html = await render(Page);
    expect(html).toContain("Paket Steril"); expect(html).toContain("Spuit dijual satuan");
    expect(html).not.toContain("BMHP spuit internal");
    expect(html).toContain("Rp 1"); expect(html).toContain("Rp 0");
    state.subtotal = 0.11;
    await expect(render(Page)).rejects.toThrow(/subtotal|verifikasi/i);
  }
});
it.each(pages)("%s accepts a verified empty zero invoice without inventing a package", async (_, Page) => {
  state.subtotal = 0; state.items = [];
  const html = await render(Page);
  expect(html).not.toContain("Paket Steril"); expect(html).toContain("INV-FIKSI");
});
