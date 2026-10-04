import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ role: "OWNER", active: true as boolean | undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: fixture.role, is_active: fixture.active } }) }) }) }),
}) }));
vi.mock("@/components/LaporanPage", () => ({ LaporanPage: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/operation-sales-server", () => ({ collectDashboard: async () => ({
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
    const page = await OperationSalesPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);
    expect(html.includes('href="/laporan/nilai-persediaan"')).toBe(allowed);
    expect(html).toContain("Coverage");
    expect(html).not.toContain("Nilai stok");
    expect(html).not.toMatch(/Rp NaN|Rp undefined/);
    if (allowed) expect(html).toContain("Lihat laporan FIFO");
  });
});
