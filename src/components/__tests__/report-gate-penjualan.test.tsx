// @vitest-environment jsdom
// A1 (meeting 12 Nov 2026): laporan penjualan dibuka kosong — query berat baru jalan
// setelah Tampilkan (tampil=1). Setelahnya, cabang terpilih ikut disaring di query.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientFixture } from "@/lib/__tests__/fixtures/hpp-report-client";

const fixture = vi.hoisted(() => ({ client: null as SupabaseClient | null, dashboard: vi.fn(), scope: vi.fn(), alerts: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fixture.client }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
vi.mock("@/lib/operation-sales-server", () => ({
  collectDashboard: fixture.dashboard,
  resolveDashboardScope: fixture.scope,
}));
vi.mock("@/lib/operational-alerts-server", () => ({ collectOperationalAlertBlock: fixture.alerts }));

import PenjualanRinciPage from "@/app/(app)/laporan/penjualan-rinci/page";
import TransaksiCabangPage from "@/app/(app)/laporan/transaksi-cabang/page";
import PelangganHarianPage from "@/app/(app)/laporan/pelanggan-harian/page";
import PenjualanKasirPage from "@/app/(app)/laporan/penjualan-kasir/page";
import RekapKlinikPage from "@/app/(app)/laporan/rekap-klinik/page";
import OperationSalesPage from "@/app/(app)/laporan/operasional-penjualan/page";

const rentang = { dari: "2026-10-23", sampai: "2026-10-24" };
const branches = [{ id: "b1", name: "Cabang Satu", is_active: true }, { id: "b2", name: "Cabang Dua", is_active: true }];
let records: ReturnType<typeof clientFixture>["records"];

beforeEach(() => {
  const f = clientFixture({ tables: { branches, sales: [], invoices: [], sales_invoices: [], invoice_items: [], inpatient_records: [], follow_ups: [] } });
  fixture.client = f.client;
  records = f.records;
  fixture.dashboard.mockReset();
  fixture.scope.mockReset().mockResolvedValue({ branchIds: ["b1"], branches: [{ id: "b1", name: "Cabang Satu" }] });
  fixture.alerts.mockReset();
});

// Query baru benar-benar dikirim saat dibaca berhalaman (range), bukan saat disusun.
const tabelDibaca = () => new Set(records.filter((r) => r.method === "range").map((r) => r.table));
const eqPada = (table: string) => records.filter((r) => r.table === table && r.method === "eq").map((r) => r.args);

type Halaman = (props: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>;
const halaman: [string, Halaman][] = [
  ["penjualan-rinci", PenjualanRinciPage as Halaman],
  ["transaksi-cabang", TransaksiCabangPage as Halaman],
  ["pelanggan-harian", PelangganHarianPage as Halaman],
  ["penjualan-kasir", PenjualanKasirPage as Halaman],
  ["rekap-klinik", RekapKlinikPage as Halaman],
];

it.each(halaman)("%s opens empty and reads only the branch list before Tampilkan", async (_nama, Page) => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ ...rentang }) }));
  expect([...tabelDibaca()]).toEqual(["branches"]);
  expect(html).toMatch(/data-report-gate="/);
  expect(html).toContain('name="tampil"');
  expect(html).toContain("Cabang Satu");
});

it.each(halaman)("%s reads its report data once Tampilkan is pressed", async (_nama, Page) => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ ...rentang, tampil: "1" }) }));
  expect(tabelDibaca().size).toBeGreaterThan(1);
  expect(html).not.toMatch(/data-report-gate="/);
});

it("pushes a registered branch id into the sales and clinic queries, but never an unknown one", async () => {
  await TransaksiCabangPage({ searchParams: Promise.resolve({ ...rentang, cabang_id: "b1", tampil: "1" }) });
  expect(eqPada("sales")).toContainEqual(["branch_id", "b1"]);
  expect(eqPada("invoices")).toContainEqual(["visits.branch_id", "b1"]);
  records.length = 0;
  await PenjualanRinciPage({ searchParams: Promise.resolve({ ...rentang, cabang_id: "bukan-uuid", tampil: "1" }) });
  expect(eqPada("sales")).toEqual([]);
  expect(eqPada("invoices").some(([kolom]) => String(kolom).includes("branch"))).toBe(false);
});

it("pushes a branch chosen by name into the cashier and daily customer queries", async () => {
  await PenjualanKasirPage({ searchParams: Promise.resolve({ ...rentang, cabang: "Cabang Dua", tampil: "1" }) });
  expect(eqPada("sales")).toContainEqual(["branches.name", "Cabang Dua"]);
  expect(eqPada("sales_returns")).toContainEqual(["sales.branches.name", "Cabang Dua"]);
  records.length = 0;
  await PelangganHarianPage({ searchParams: Promise.resolve({ ...rentang, cabang: "Cabang Dua", tampil: "1" }) });
  expect(eqPada("invoices")).toContainEqual(["visits.branches.name", "Cabang Dua"]);
});

it("pushes the clinic recap branch into all three clinic sources", async () => {
  await RekapKlinikPage({ searchParams: Promise.resolve({ ...rentang, cabang: "b2", tampil: "1" }) });
  expect(eqPada("invoice_items")).toContainEqual(["invoices.visits.branch_id", "b2"]);
  expect(eqPada("inpatient_records")).toContainEqual(["branch_id", "b2"]);
  expect(eqPada("follow_ups")).toContainEqual(["branch_id", "b2"]);
});

it("keeps Tampilkan on branch and daily drill-down links of the branch report", async () => {
  fixture.client = clientFixture({ tables: { branches, sales: [{ id: "s", branch_id: "b1", customer_id: null, total: 10, channel: null,
    created_at: "2026-10-23T03:00:00Z", branches: { name: "Cabang Satu" }, sale_items: [], payment_plan: null, payments_finalized_at: null, voided_at: null }],
  invoices: [], sales_invoices: [] } }).client;
  const html = renderToStaticMarkup(await TransaksiCabangPage({ searchParams: Promise.resolve({ ...rentang, tampil: "1" }) }));
  const links = [...html.matchAll(/href="([^"]*(?:cabang_id|penjualan-rinci)[^"]*)"/g)].map((m) => new URLSearchParams(m[1].replaceAll("&amp;", "&").split("?")[1]));
  expect(links.length).toBeGreaterThanOrEqual(2);
  for (const params of links) expect(params.get("tampil")).toBe("1");
});

it("operation & sales cockpit reads only the branch scope before Tampilkan", async () => {
  const html = renderToStaticMarkup(await OperationSalesPage({ searchParams: Promise.resolve({}) }));
  expect(fixture.dashboard).not.toHaveBeenCalled();
  expect(fixture.alerts).not.toHaveBeenCalled();
  expect(fixture.scope).toHaveBeenCalledTimes(1);
  expect(html).toMatch(/data-report-gate="/);
  expect(html).toContain("Cabang Satu");
});
