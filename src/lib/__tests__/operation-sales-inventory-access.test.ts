import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ role: "OWNER", active: true as boolean | undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: fixture.role, is_active: fixture.active } }) }) }) }),
}) }));
vi.mock("@/components/LaporanPage", () => ({ LaporanPage: ({ children }: { children: React.ReactNode }) => children }));
const comparisonRow = (branchId: string, branchName: string) => ({
  branchId, branchName,
  sekarang: { petshop: { transaksi: 4, omzet: 480000, rataRata: 120000, customer: 3 }, klinik: { transaksi: 2, omzet: 300000, rataRata: 150000, customer: 2 }, grooming: 6 },
  bulanLalu: { petshop: { transaksi: 5, omzet: 500000, rataRata: 100000, customer: 4 }, klinik: { transaksi: 0, omzet: 0, rataRata: null, customer: 0 }, grooming: 6 },
});
vi.mock("@/lib/operation-sales-server", () => ({ collectDashboard: async (_client: unknown, _filter: unknown, options?: { includeStockValue?: boolean }) => ({
  comparison: { status: "ready", data: {
    periode: { from: "2026-10-01", to: "2026-10-04" }, pembanding: { from: "2026-09-01", to: "2026-09-04" },
    rows: [comparisonRow("b1", "Cabang Satu")], total: comparisonRow("*", "Total"),
  } },
  stockValue: options?.includeStockValue ? { status: "ready", data: {
    tanggal: "2026-10-04", tanggalPembanding: "2026-09-04", metode: "fifo",
    rows: [{ branchId: "b1", branchName: "Cabang Satu", sekarang: { petshop: 2500000, klinik: 900000 }, bulanLalu: { petshop: 2000000, klinik: 1000000 } }],
    total: { branchId: "*", branchName: "Total", sekarang: { petshop: 2500000, klinik: 900000 }, bulanLalu: { petshop: 2000000, klinik: 1000000 } },
  } } : null,
  scope: { branchIds: ["b1"], branches: [{ id: "b1", name: "Cabang Satu" }] },
  filter: { from: "2026-10-01", to: "2026-10-04", channel: "all" },
  sales: { status: "missing", reason: "fixture" }, branch: { status: "missing", reason: "fixture" },
  customer: { status: "missing", reason: "fixture" }, purchase: { status: "missing", reason: "fixture" },
  clinic: { status: "missing", reason: "fixture" },
  stock: { status: "ready", data: { coverageDays: 10, lowStock: 0, fastMoving: [], slowMoving: [] } },
}) }));
vi.mock("@/lib/operational-alerts-server", () => ({ collectOperationalAlertBlock: async () => ({ status: "missing", reason: "fixture" }) }));

import OperationSalesPage from "../../app/(app)/laporan/operasional-penjualan/page";

afterEach(() => vi.unstubAllEnvs());
describe("dashboard inventory value entry", () => {
  it.each([
    ["OWNER", true, true], ["FINANCE", true, true],
    ["ADMIN", true, false], ["DOCTOR", true, false], ["STAFF", true, false],
    ["OWNER", false, false], ["FINANCE", false, false], ["OWNER", undefined, false],
  ] as const)("role %s active=%s exposes report link=%s", async (role, active, allowed) => {
    fixture.role = role;
    fixture.active = active;
    vi.stubEnv("OPERATION_SALES_ROLLOUT_ROLES", "FINANCE,DOCTOR,STAFF");
    const page = await OperationSalesPage({ searchParams: Promise.resolve({ tampil: "1" }) });
    const html = renderToStaticMarkup(page);
    expect(html.includes('href="/laporan/nilai-persediaan"')).toBe(allowed);
    expect(html).toContain("Coverage");
    // Perbandingan cabang tampil untuk semua peran yang boleh membuka dashboard…
    expect(html).toContain("CABANG vs BULAN LALU");
    expect(html).toContain("Rp 120.000");
    expect(html).toContain("▲ 20,0%");
    expect(html).toContain("▼ 20,0%");
    expect(html).toContain("baru");
    // …tetapi nilai stok HPP hanya untuk OWNER/FINANCE aktif.
    expect(html.includes("Nilai stok (HPP)")).toBe(allowed);
    expect(html.includes("Rp 2.500.000")).toBe(allowed);
    if (allowed) expect(html).toContain("▲ 25,0%");
    expect(html).not.toMatch(/Rp NaN|Rp undefined/);
    if (allowed) expect(html).toContain("Lihat laporan FIFO");
  });
});
