import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ missingName: false, inconsistent: false, flatName: false }));
vi.mock("@/lib/clinic-payment", () => ({ loadClinicPaymentMaster: async () => ({ obat: [], jasa: [] }), loadClinicPackages: async () => { throw new Error("Read-only history must not use current recipes"); } }));
vi.mock("@/lib/dp-minimal", () => ({ getDpMinimalPercent: async () => 50, bolehMenerobosDp: () => false }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/InpatientCashier", () => ({ InpatientCashier: () => null }));
import { InpatientPaymentPage } from "@/app/(app)/klinik/pembayaran/[visitId]/InpatientPaymentPage";
function lines() { const rows = [
  { id: "issued-material", invoice_id: "issued", deskripsi: "Bahan rahasia", qty: 2, harga: 12300, package_item_id: "package", package_qty: 2, package: state.missingName ? null : { name: "Paket tersimpan" } },
  { id: "issued-service", invoice_id: "issued", deskripsi: "Jasa isi rahasia", qty: 2, harga: 110700, package_item_id: "package", package_qty: state.inconsistent ? 3 : 2, package: { name: "Paket tersimpan" } },
  { id: "standalone", invoice_id: "issued", deskripsi: "Bahan terpisah", qty: 1, harga: 1000, package_item_id: null, package_qty: null },
]; return state.flatName ? rows.map(({ package: relation, ...row }) => row.package_item_id ? { ...row, package_name: relation?.name ?? null } : row) : rows; }
async function render() {
  const db = { rpc: async () => ({ error: null, data: { state: "SHIFT_REQUIRED", snapshot: null, quote: null, history: [{ id: "issued", invoice_no: "INVOICE-TETAP", total: 247000, received: 123000, dp_amount: 40000, paid_status: "DP", correction_pending: false, lines: lines() }], receipts: [], applications: [] } }), from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { role: "FINANCE" }, error: null }) }; return q; } };
  return renderToStaticMarkup(await InpatientPaymentPage({ db: db as never, visitId: "visit", recordId: "stay", branchId: "branch", userId: "user", query: {}, patient: { photo: null, name: "Pasien", species: "Kucing", owner: "Pemilik", phone: "", address: "", dokter: "Dokter", jenisLayanan: "Rawat Inap", noInvoice: "(baru)", tanggal: "2026-11-02" } }));
}
beforeEach(() => { state.missingName = false; state.inconsistent = false; state.flatName = false; });
it("renders issued history as one persisted-origin package plus ordinary sale, with exact issued amounts and no component names", async () => {
  const html = await render();
  expect(html).toContain("Paket tersimpan"); expect(html).toContain("Bahan terpisah");
  expect(html).not.toContain("Bahan rahasia"); expect(html).not.toContain("Jasa isi rahasia");
  expect(html).toContain("Rp 123.000"); expect(html).toContain("Rp 247.000"); expect(html).toContain("Rp 40.000");
  expect(html).toContain('data-history-source-ids="issued-material,issued-service"');
  expect(html).toContain('data-history-source-ids="standalone"');
});
it("accepts the real native history flat package_name shape without exposing source components", async () => {
  state.flatName = true;
  const html = await render();
  expect(html).toContain("Paket tersimpan"); expect(html).toContain("Bahan terpisah");
  expect(html).not.toContain("Bahan rahasia"); expect(html).not.toContain("Jasa isi rahasia");
  expect(html).not.toContain("belum dapat diverifikasi");
  expect(html).toContain('data-history-source-ids="issued-material,issued-service"');
  expect(html).toContain("Rp 247.000"); expect(html).toContain("Rp 40.000");
});
it("fails closed when the native flat package name is null", async () => {
  state.flatName = true; state.missingName = true;
  const html = await render();
  expect(html).toContain("belum dapat diverifikasi"); expect(html).not.toContain("Bahan rahasia");
  expect(html).toContain("Rp 247.000");
});
it.each(["missingName", "inconsistent"] as const)("fails closed for %s history origin instead of revealing components or rewriting issued money", async mode => {
  state[mode] = true; const html = await render();
  expect(html).toContain("belum dapat diverifikasi"); expect(html).not.toContain("Bahan rahasia"); expect(html).not.toContain("Jasa isi rahasia");
  expect(html).toContain("INVOICE-TETAP"); expect(html).toContain("Rp 247.000"); expect(html).toContain("Rp 40.000");
});
