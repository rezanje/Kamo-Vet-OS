import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import PenjualanRinciPage from "@/app/(app)/laporan/penjualan-rinci/page";

it("opens each saved clinic invoice in a shared visit from the sales detail report", async () => {
  const visitId = "20000000-0000-4000-8000-000000000002";
  const firstId = "30000000-0000-4000-8000-000000000003";
  const secondId = "40000000-0000-4000-8000-000000000004";
  mocks.createClient.mockResolvedValue(clientFixture({ tables: {
    sales: [], sales_returns: [],
    invoices: [
      { id: firstId, visit_id: visitId, invoice_no: "INV.2026.001", total: 100, metode_bayar: "Tunai", paid_status: "Lunas", voided_at: null, created_at: "2026-10-24T05:00:00Z", visits: { branch_id: "b1", branches: { name: "Satu" }, customers: { name: "Fiktif" } } },
      { id: secondId, visit_id: visitId, invoice_no: "INV.2026.002", total: 200, metode_bayar: "Transfer", paid_status: "Belum Lunas", voided_at: null, created_at: "2026-10-24T06:00:00Z", visits: { branch_id: "b1", branches: { name: "Satu" }, customers: { name: "Fiktif" } } },
    ],
  } }).client);
  const html = renderToStaticMarkup(await PenjualanRinciPage({ searchParams: Promise.resolve({ dari: "2026-10-24", sampai: "2026-10-24", kanal: "Klinik" }) }));
  expect(html).toContain(`/klinik/pembayaran/${visitId}/invoice?invoice_id=${firstId}`);
  expect(html).toContain(`/klinik/pembayaran/${visitId}/invoice?invoice_id=${secondId}`);
});
