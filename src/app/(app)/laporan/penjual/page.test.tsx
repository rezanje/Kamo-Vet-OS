import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  sales: [] as Array<Record<string, unknown>>,
  rows: {
    employees: [
      { id: "employee-1", nama: "Sari", profile_id: "profile-1", status: "Aktif" },
      { id: "employee-2", nama: "Sari", profile_id: "profile-2", status: "Aktif" },
    ],
    items: [],
    sales_invoices: [
      { id: "invoice-1", no_faktur: "F-1", tanggal: "2026-10-01", jatuh_tempo: null, total: 100, carried_paid: 0, status: "belum", created_by: "profile-1", customers: null },
      { id: "invoice-2", no_faktur: "F-2", tanggal: "2026-10-02", jatuh_tempo: null, total: 200, carried_paid: 0, status: "belum", created_by: "profile-2", customers: null },
    ],
    sales_receipts: [],
  } as Record<string, unknown[]>,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: (table: string) => {
    const query = { table, select: () => query, neq: () => query, is: () => query, gte: () => query, lte: () => query };
    return query;
  },
}) }));
vi.mock("@/lib/report-query", () => ({ completeReportQuery: async (query: { table: string }) => ({ data: fixture.rows[query.table] }) }));
vi.mock("@/lib/komisi-data", () => ({ kumpulkanBarisKomisi: async () => ({ baris: fixture.sales, omzetTanpaPenjual: 0 }) }));
vi.mock("@/components/LaporanPage", () => ({
  LaporanPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  KartuAngka: () => null,
  TabelKosong: () => null,
}));
vi.mock("@/components/ServiceAttributionTable", () => ({ ServiceAttributionTable: () => null }));

import PenjualPage from "./page";

it("keeps invoices of same-named employees separate by stored employee ID", async () => {
  const html = renderToStaticMarkup(await PenjualPage({ searchParams: Promise.resolve({ periode: "2026-10" }) }));
  const summary = html.split("02 · FAKTUR BELUM LUNAS PER PENJUAL")[1].split("03 · RINCIAN FAKTUR PENJUALAN")[0];

  expect(summary.match(/<tr>/g)).toHaveLength(3); // header and one row for each employee
  expect(summary).toContain("Rp 100");
  expect(summary).toContain("Rp 200");
  expect(summary).not.toContain("Rp 300");
  expect(summary).toContain("Sari (ID ployee-1)");
  expect(summary).toContain("Sari (ID ployee-2)");
});

it("keeps the invoice totals with the same employee after their display name changes", async () => {
  const employee = fixture.rows.employees[0] as { nama: string };
  employee.nama = "Maya";
  try {
    const html = renderToStaticMarkup(await PenjualPage({ searchParams: Promise.resolve({ periode: "2026-10" }) }));
    const summary = html.split("02 · FAKTUR BELUM LUNAS PER PENJUAL")[1].split("03 · RINCIAN FAKTUR PENJUALAN")[0];

    expect(summary.match(/<tr>/g)).toHaveLength(3);
    expect(summary).toContain("Maya");
    expect(summary).toContain("Sari");
    expect(summary).not.toContain("(ID ");
    expect(summary).toContain("Rp 100");
    expect(summary).toContain("Rp 200");
  } finally {
    employee.nama = "Sari";
  }
});

it("disambiguates same-named employees in sales summary and product details", async () => {
  fixture.sales = ["employee-1", "employee-2"].map((employeeId) => ({
    employeeId, sumber: "kasir", itemId: null, qty: 1, omzet: 100, laba: 25,
  }));
  try {
    const html = renderToStaticMarkup(await PenjualPage({ searchParams: Promise.resolve({ periode: "2026-10" }) }));
    const sales = html.split("01 · REKAP PER PENJUAL")[1].split("02 · FAKTUR BELUM LUNAS PER PENJUAL")[0];
    expect(sales.match(/Sari \(ID ployee-1\)/g)).toHaveLength(2);
    expect(sales.match(/Sari \(ID ployee-2\)/g)).toHaveLength(2);
  } finally {
    fixture.sales = [];
  }
});
