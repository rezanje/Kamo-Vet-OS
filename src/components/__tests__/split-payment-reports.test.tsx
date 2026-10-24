// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ sales: [] as Record<string, unknown>[] }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/components/LocalTransactionDraft", () => ({ TransactionForm: ({ children }: { children: React.ReactNode }) => <form>{children}</form> }));
vi.mock("@/components/dokumen/DokumenPanel", () => ({ DokumenPanel: () => null }));
vi.mock("@/components/LaporanPage", () => ({ LaporanPage: ({ ringkasan, children }: { ringkasan: React.ReactNode; children: React.ReactNode }) => <main>{ringkasan}{children}</main>,
  KartuAngka: ({ items }: { items: { label: string; nilai: string }[] }) => <div>{items.map(i => <div key={i.label}>{i.label}{i.nilai}</div>)}</div>, TabelKosong: () => null }));
vi.mock("@/app/(app)/pos/shift/actions", () => ({ openShift: async () => {}, closeShift: async () => {}, forceCloseShift: async () => {} }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift", opened_at: "2026-10-15T05:00:00Z", branchName: "A" }) }));
vi.mock("@/app/kasir/tutup/TutupForm", () => ({ TutupForm: () => null }));
vi.mock("@/components/PostingRequestIdentity", () => ({ PostingRequestIdentity: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from(table: string) {
    const filters: Record<string, unknown> = {};
    const data = () => table === "sales" ? fixture.sales.filter(s => Object.entries(filters).every(([k,v]) => !(k in s) || s[k] === v))
      : table === "sale_items" ? fixture.sales.map(sale => ({ id: `item-${sale.id}`, sale_id: sale.id, nama: "Makanan", qty: 1, harga: 100000, sales: sale }))
      : table === "expenses" ? [{ jumlah: 2000, metode_bayar: "Tunai" }]
      : table === "cashier_shifts" ? filters.status === "closed" ? [] : [{ id: "shift", opening_balance: 100000, opened_at: "2026-10-15T05:00:00Z", branch_id: "branch", branches: { name: "A" } }]
      : table === "customers" ? [{ id: "c1", name: "Customer", phone: "", customer_categories: null }]
      : [];
    const result = () => ({ data: data(), error: null, count: data().length });
    const q = { select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; },
      is: () => q, in: () => q, order: () => q, limit: () => q, lt: () => q, gt: () => q, gte: () => q, lte: () => q, ilike: () => q,
      range: async () => result(), maybeSingle: async () => ({ data: table === "profiles" ? { role: "ADMIN" } : data()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return q;
  },
}) }));

import ShiftPage from "@/app/(app)/pos/shift/page";
import PenjualanRinciPage from "@/app/(app)/laporan/penjualan-rinci/page";
import PenjualanDetailPage from "@/app/(app)/penjualan/[id]/page";
import PenjualanKasirPage from "@/app/(app)/laporan/penjualan-kasir/page";
import PelangganTeratasPage from "@/app/(app)/laporan/pelanggan-teratas/page";
import PromoPage from "@/app/(app)/laporan/promo/page";
import PenjualanPage from "@/app/(app)/penjualan/page";
import { ambilPenjualanBarang } from "@/app/(app)/laporan/penjualan-barang/data";
import TutupShiftPage from "@/app/kasir/tutup/page";
import { detailPelanggan } from "@/app/(app)/crm/pelanggan/actions";
import DashboardPage from "@/app/(app)/page";
import ReturKasirPage from "@/app/kasir/retur/page";
import ReturJualBaruPage from "@/app/(app)/penjualan/retur/baru/page";

beforeEach(() => {
  fixture.sales = [{ id: "sale", no_struk: "POS-split", total: 100000, subtotal: 100000, discount: 0, metode_bayar: "Split", bayar: 110000, kembali: 10000,
    channel: null, customer_id: "c1", cashier_id: "actor", shift_id: "shift", created_at: "2026-10-15T05:00:00Z", branches: { name: "A" }, customers: null, kasir: null, sale_items: [],
    sale_payments: [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }],
    payment_plan: [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }], payments_finalized_at: "2026-10-15T05:00:01Z" }];
});
const doc = (element: React.ReactNode) => new DOMParser().parseFromString(renderToStaticMarkup(element), "text/html");

it("shows split cash in the running shift and counts the sale once", async () => {
  fixture.sales.push({ ...fixture.sales[0], id: "pending", payments_finalized_at: null });
  const page = doc(await ShiftPage({ searchParams: Promise.resolve({}) }));
  expect(page.body.textContent).toContain("Penjualan tunaiRp 20.0001 transaksi");
  expect(page.body.textContent).toContain("Kas seharusnyaRp 118.000");
});

it("shows each allocation in one detailed sales row available to report exports", async () => {
  fixture.sales.push({ ...fixture.sales[0], id: "pending", payments_finalized_at: null });
  const page = doc(await PenjualanRinciPage({ searchParams: Promise.resolve({ dari: "2026-10-15", sampai: "2026-10-15" }) }));
  expect(page.body.textContent).toContain("Jumlah transaksi1x");
  expect(page.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(page.querySelector("tbody")?.textContent).toContain("Tunai Rp 20.000 + Transfer Rp 80.000");
});

it("shows the original cash and transfer allocation on the sale detail", async () => {
  const page = doc(await PenjualanDetailPage({ params: Promise.resolve({ id: "sale" }), searchParams: Promise.resolve({}) }));
  expect(page.body.textContent).toContain("TunaiRp 20.000");
  expect(page.body.textContent).toContain("TransferRp 80.000");
  expect(page.body.textContent).toContain("KembalianRp 10.000");
});

it.each([
  ["cashier", PenjualanKasirPage, "Total transaksi1x"],
  ["customer", PelangganTeratasPage, "Jumlah transaksi1x"],
  ["promo", PromoPage, "Rp 100.000"],
] as const)("excludes unfinished sales from the %s report", async (_name, Page, expected) => {
  fixture.sales.push({ ...fixture.sales[0], id: "pending", payments_finalized_at: null });
  const page = doc(await Page({ searchParams: Promise.resolve({ dari: "2026-10-15", sampai: "2026-10-15" }) }));
  expect(page.body.textContent).toContain(expected);
  expect(page.body.textContent).not.toContain("Rp 200.000");
});

it("excludes unfinished sales from the sales overview and product totals", async () => {
  fixture.sales.push({ ...fixture.sales[0], id: "pending", payments_finalized_at: null });
  const page = doc(await PenjualanPage({ searchParams: Promise.resolve({ dari: "2026-10-15", sampai: "2026-10-15" }) }));
  expect(page.body.textContent).toContain("Total Transaksi1");
  expect(page.body.textContent).not.toContain("Rp 200.000");
});

it("excludes unfinished sale items from the product report", async () => {
  fixture.sales.push({ ...fixture.sales[0], id: "pending", payments_finalized_at: null });
  const report = await ambilPenjualanBarang({ dari: "2026-10-15", sampai: "2026-10-15", kanal: "POS", jenis: "Barang", q: "" });
  expect(report.pesanError).toBe("");
  expect(report.nilaiTotal).toBe(100000);
  expect(report.rows).toHaveLength(1);
});

it("counts completed sale headers once on the cashier shift-close screen", async () => {
  fixture.sales.push({ ...fixture.sales[0], id: "pending", payments_finalized_at: null });
  const page = doc(await TutupShiftPage({ searchParams: Promise.resolve({}) }));
  expect(page.body.textContent).toContain("1 transaksi");
  expect(page.body.textContent).not.toContain("2 transaksi");
});

it("excludes an unfinished checkout from customer history and spending", async () => {
  fixture.sales[0].sale_items = [{ nama: "Makanan", qty: 1, harga: 100000 }];
  fixture.sales.push({ ...fixture.sales[0], id: "pending", payments_finalized_at: null });
  const result = await detailPelanggan("c1");
  expect(result.purchases).toHaveLength(1);
  expect(result.stat).toMatchObject({ petshopCount: 1, petshopTotal: 100000 });
});

it.each(["operasional", "marketing"])("excludes pending sales from the %s dashboard", async sudut => {
  fixture.sales.push({ ...fixture.sales[0], id: "pending", payments_finalized_at: null });
  const page = await DashboardPage({ searchParams: Promise.resolve({ sudut }) });
  const render = page.type as (props: { sudut: string }) => Promise<React.ReactNode>;
  const content = doc(await render({ sudut }));
  if (sudut === "operasional") {
    expect(content.body.textContent).toContain("Transaksi kasir hari ini1");
    expect(content.body.textContent).toContain("Rp 100.000");
    expect(content.body.textContent).not.toContain("Rp 200.000");
  } else {
    expect(content.body.textContent).toContain("Makanan");
    expect(content.body.textContent).toContain("1 terjual");
  }
});

it.each([["cashier", ReturKasirPage], ["backoffice", ReturJualBaruPage]] as const)("blocks refund choices for an unfinished sale in %s", async (_name, Page) => {
  fixture.sales[0].payments_finalized_at = null;
  const page = doc(await Page({ searchParams: Promise.resolve({ struk: "POS-split" }) }));
  expect(page.body.textContent).toContain("Pembayaran struk ini belum selesai");
});
