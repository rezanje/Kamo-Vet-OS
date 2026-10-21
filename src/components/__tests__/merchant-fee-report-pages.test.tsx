// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { displaySections } from "@/lib/report-display-export";
const fixture = vi.hoisted(() => ({ fee: true }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("not found"); } }));
vi.mock("@/components/UnduhLaporan", () => ({ UnduhLaporan: () => null }));
vi.mock("@/components/dokumen/DokumenPanel", () => ({ DokumenPanel: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  from(table: string) {
    let selected = "";
    const sale = { id: "sale", no_struk: "POS-fee", created_at: "2026-10-16T05:00:00Z", subtotal: 120000, discount: 20000,
      total: fixture.fee ? 101600.01 : 100000, merchant_fee_total: fixture.fee ? 1600.01 : 0,
      channel: null, marketplace_status: null, metode_bayar: "Split", bayar: fixture.fee ? 131600.01 : 130000, kembali: 30000,
      payment_plan: [], payments_finalized_at: "2026-10-16T05:00:01Z",
      sale_payments: [{ method: "Tunai", amount: 20000 }, { method: "Debit", amount: fixture.fee ? 81600.01 : 80000, fee_percent: 2, fee_amount: fixture.fee ? 1600.01 : 0 }],
      branches: { name: "Cabang" }, customers: { name: "Customer", phone: null }, kasir: { full_name: "Staff" }, sale_items: [] };
    const data = table === "sales" ? [sale, { ...sale, id: "pending", no_struk: "POS-pending", payments_finalized_at: null }]
      : table === "sales_returns" ? [{ id: "return", sale_id: "sale", no_retur: "RET-1", tanggal: "2026-10-16", total: fixture.fee ? 50800 : 50000, sales_return_items: [] }]
      : [];
    const project = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => selected.split(/[,()]/).map(part => part.trim()).includes(key)));
    const q = { select: (value: string) => { selected = value; return q; }, eq: () => q, gte: () => q, lte: () => q, is: () => q, order: () => q,
      range: async () => ({ data: data.map(project), count: data.length, error: null }),
      maybeSingle: async () => ({ data: project(sale), error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) };
    return q;
  },
}) }));
import DetailPage from "@/app/(app)/penjualan/[id]/page";
import ReportPage from "@/app/(app)/laporan/penjualan-rinci/page";
beforeEach(() => { fixture.fee = true; });

it("shows merchandise, merchant fee and final bill separately on sale detail", async () => {
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id: "sale" }), searchParams: Promise.resolve({}) })), "text/html");
  expect(doc.body.textContent).toContain("Total barangRp 100.000");
  expect(doc.body.textContent).toContain("Fee merchantRp 1.600,01");
  expect(doc.body.textContent).toContain("Rp 101.600,01");
  expect(doc.body.textContent).toContain("DebitRp 81.600,01");
});

it("exports one completed header, goods and fee figures separately while keeping gross document totals", async () => {
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(await ReportPage({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-31" }) })), "text/html");
  const sections = displaySections(doc.querySelector("#laporan-isi")!);
  const table = sections.find(section => section.rows.some(row => row.includes("No. Dokumen")))!;
  expect(table.rows[0]).toEqual(expect.arrayContaining(["Nilai sebelum fee", "Fee merchant", "Retur fee", "Total bersih"]));
  expect(table.rows).toHaveLength(2);
  expect(table.rows[1]).toEqual(expect.arrayContaining(["POS-fee", "Rp 100.000", "Rp 1.600,01", "− Rp 800", "Tunai Rp 20.000 + Debit Rp 81.600,01"]));
  expect(doc.body.textContent).toContain("Jumlah transaksi1x");
  expect(doc.body.textContent).not.toContain("POS-pending");
});

it("does not invent a fee for historical sales", async () => {
  fixture.fee = false;
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id: "sale" }), searchParams: Promise.resolve({}) })), "text/html");
  expect(doc.body.textContent).not.toContain("Fee merchant");
  expect(doc.body.textContent).toContain("Rp 100.000");
});
