// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ long: false, voucher: false, split: false, invalidSplit: false, pending: false, decimal: false, merchantFee: false }));
vi.mock("@/components/ActiveBranch", () => ({ ActiveBranch: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/kasir/struk/receipt", useSearchParams: () => new URLSearchParams(),
  redirect: () => { throw Error("redirect"); }, notFound: () => { throw Error("not found"); } }));
vi.mock("@/app/login/actions", () => ({ logout: async () => {} }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ branch_id: "branch", branchName: "Cabang Uji" }) }));
vi.mock("@/components/PrintButton", () => ({ PrintButton: () => <button className="no-print">Cetak Struk</button>,
  AutoPrint: () => <span className="no-print" data-auto-print="true" /> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor", email: "operator@example.test" } } }) },
  from(table: string) {
    const sale = { id: "receipt", no_struk: "POS-20261013-0001", subtotal: fixture.long ? 750000 : 125000,
      discount: fixture.long ? 0 : 5000, total: fixture.split ? 100000 : fixture.long ? 750000 : 120000, metode_bayar: fixture.split ? "Split" : "Tunai",
      bayar: fixture.split ? 110000 : fixture.long ? 1000000 : 150000, kembali: fixture.split ? 10000 : fixture.long ? 250000 : 30000,
      sale_payments: fixture.split && !fixture.invalidSplit ? [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }] : [],
      payment_plan: fixture.pending ? [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }] : null,
      payments_finalized_at: null,
      poin_earned: 15, poin_digunakan: 0, voucher_code: fixture.voucher ? "VOUCHER1234567890123456789" : null, created_at: "2026-10-13T07:00:00Z",
      customers: { name: "PelangganDenganNamaSangatPanjangTanpaSpasiUntukMemeriksaPembungkusanTeks" }, branches: { name: "Cabang Uji Struk" } };
    if (fixture.decimal) Object.assign(sale, { subtotal: 33.33, discount: 0.01, total: 33.32, metode_bayar: "Split", bayar: 33.32, kembali: 0,
      sale_payments: [{ method: "Tunai", amount: 10 }, { method: "Transfer", amount: 23.32 }] });
    if (fixture.merchantFee) Object.assign(sale, { subtotal: fixture.decimal ? 100000.5 : 100000, discount: 0,
      total: fixture.decimal ? 101600.51 : 101600, merchant_fee_total: fixture.decimal ? 1600.01 : 1600,
      metode_bayar: "Split", bayar: fixture.decimal ? 131600.51 : 131600, kembali: 30000,
      payment_plan: [{ method: "Tunai", amount: 20000 }, { method: "Debit", amount: fixture.decimal ? 81600.51 : 81600, fee_percent: 2, fee_amount: fixture.decimal ? 1600.01 : 1600 }],
      payments_finalized_at: "2026-10-16T07:00:01Z",
      sale_payments: [{ method: "Tunai", amount: 20000 }, { method: "Debit", amount: fixture.decimal ? 81600.51 : 81600, fee_percent: 2, fee_amount: fixture.decimal ? 1600.01 : 1600 }] });
    const item = { nama: "BarangDenganNamaSangatPanjangTanpaSpasiUntukPengujianCetak", qty: fixture.long ? 1 : 5,
      satuan: "BotolDenganUkuranSangatPanjang100mL", harga: 25000, item_discount_type: null,
      item_discount_value: 0, promos: null, sale_item_group_components: [{ component_name: "Komponen panjang", qty_per_group: 2, unit: "pcs", sort_order: 1 }] };
    const data = table === "sales" ? sale : table === "sale_items" ? Array.from({ length: fixture.long ? 30 : 1 }, () => item)
      : table === "profiles" ? { full_name: "Operator Uji", is_active: true } : [];
    const q = { select: () => q, eq: () => q, is: () => q, order: () => q,
      maybeSingle: async () => ({ data, error: null }), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) };
    return q;
  },
}) }));
import ReceiptPage from "@/app/kasir/struk/[saleId]/page";
import BackofficeReceiptPage from "@/app/(app)/pos/struk/[saleId]/page";
import KasirLayout from "@/app/kasir/layout";

beforeEach(() => { fixture.long = false; fixture.voucher = false; fixture.split = false; fixture.invalidSplit = false; fixture.pending = false; fixture.decimal = false; fixture.merchantFee = false; });
async function render(print = "") {
  const page = await ReceiptPage({ params: Promise.resolve({ saleId: "receipt" }), searchParams: Promise.resolve({ print }) });
  const markup = renderToStaticMarkup(await KasirLayout({ children: page }));
  const output = process.env.POS58_RENDER_DIR;
  if (output) {
    mkdirSync(output, { recursive: true });
    const css = readFileSync("src/app/globals.css", "utf8").replace('@import "tailwindcss";', "");
    writeFileSync(join(output, `${fixture.voucher ? "voucher" : fixture.long ? "long" : "short"}.html`), `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${markup}</body></html>`);
  }
  return new DOMParser().parseFromString(markup, "text/html");
}

it("fits the 48 mm printable area of a POS58 receipt", async () => {
  const doc = await render();
  const receipt = [...doc.querySelectorAll<HTMLDivElement>('div[style*="mm"]')].find(div => div.textContent?.includes("KAMO PETSHOP"))!;
  expect(receipt).toBeDefined();
  expect(parseFloat(receipt.style.width)).toBeLessThanOrEqual(48);
});

it("prints each split allocation and cash change on the cashier receipt", async () => {
  fixture.split = true;
  const doc = await render();
  for (const text of ["TunaiRp 20.000", "TransferRp 80.000", "Tunai diterimaRp 30.000", "KembaliRp 10.000"]) {
    expect(doc.body.textContent).toContain(text);
  }
  expect(doc.body.textContent).not.toContain("SplitRp 110.000");
  expect(parseFloat(doc.querySelector<HTMLDivElement>(".kasir-receipt")!.style.width)).toBeLessThanOrEqual(48);
});

it("prints the same split allocation on the backoffice receipt", async () => {
  fixture.split = true;
  const page = await BackofficeReceiptPage({ params: Promise.resolve({ saleId: "receipt" }) });
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(page), "text/html");
  for (const text of ["TunaiRp 20.000", "TransferRp 80.000", "Tunai diterimaRp 30.000", "KembaliRp 10.000"]) {
    expect(doc.body.textContent).toContain(text);
  }
});

it.each([false, true])("separates merchandise, merchant fee and gross receipt on both receipts (cents=%s)", async decimal => {
  fixture.merchantFee = true;
  fixture.decimal = decimal;
  const cashier = await render();
  const backoffice = new DOMParser().parseFromString(renderToStaticMarkup(await BackofficeReceiptPage({ params: Promise.resolve({ saleId: "receipt" }) })), "text/html");
  for (const doc of [cashier, backoffice]) {
    for (const text of [decimal ? "Total barangRp 100.000,5" : "Total barangRp 100.000", decimal ? "Fee merchantRp 1.600,01" : "Fee merchantRp 1.600",
      decimal ? "TOTALRp 101.600,51" : "TOTALRp 101.600", "TunaiRp 20.000", decimal ? "DebitRp 81.600,51" : "DebitRp 81.600", "Tunai diterimaRp 50.000", "KembaliRp 30.000"]) {
      expect(doc.body.textContent).toContain(text);
    }
  }
});

it("preserves accepted cents on both receipts while keeping integer allocations simple", async () => {
  fixture.decimal = true;
  const cashier = await render();
  const backoffice = new DOMParser().parseFromString(renderToStaticMarkup(await BackofficeReceiptPage({ params: Promise.resolve({ saleId: "receipt" }) })), "text/html");
  for (const doc of [cashier, backoffice]) {
    expect(doc.body.textContent).toContain("TransferRp 23,32");
    expect(doc.body.textContent).toContain("TunaiRp 10");
    expect(doc.body.textContent).toContain("Rp 33,32");
  }
});

it("refuses a receipt with a missing split allocation", async () => {
  fixture.split = true; fixture.invalidSplit = true;
  await expect(render()).rejects.toThrow(/pembayaran/i);
});

it("does not print an unfinished planned sale as a successful receipt", async () => {
  fixture.split = true; fixture.pending = true;
  await expect(render()).rejects.toThrow(/belum selesai/i);
});

it("retains item quantities, discounts, totals and cash change", async () => {
  const doc = await render("1");
  expect(doc.body.textContent).toContain("5 BotolDenganUkuranSangatPanjang100mL x Rp 25.000");
  for (const amount of ["Rp 125.000", "Rp 5.000", "Rp 120.000", "Rp 150.000", "Rp 30.000"]) expect(doc.body.textContent).toContain(amount);
  expect(doc.querySelector('[data-auto-print="true"]')).not.toBeNull();
});

it("keeps long receipts complete without auto-printing a manual view", async () => {
  fixture.long = true;
  const doc = await render();
  expect(doc.body.textContent).toContain("Rp 750.000");
  expect(doc.body.textContent).toContain("Rp 250.000");
  expect(doc.body.textContent?.match(/BarangDenganNamaSangatPanjang/g)).toHaveLength(30);
  expect(doc.querySelector('[data-auto-print="true"]')).toBeNull();
});

it("retains a long voucher code alongside its discount and total", async () => {
  fixture.voucher = true;
  const doc = await render();
  expect(doc.body.textContent).toContain("Diskon + voucher VOUCHER1234567890123456789");
  expect(doc.body.textContent).toContain("-Rp 5.000");
  expect(doc.body.textContent).toContain("Rp 120.000");
});
