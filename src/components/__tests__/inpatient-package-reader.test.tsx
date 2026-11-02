import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { ClinicPackageOption } from "@/lib/clinic-payment";
const state = vi.hoisted(() => ({ readOnly: false, fail: false, partial: false, ranges: [] as number[] }));
vi.mock("@/lib/clinic-payment", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/clinic-payment")>(), loadClinicPaymentMaster: async () => ({ obat: [], jasa: [] }) }));
vi.mock("@/lib/dp-minimal", () => ({ getDpMinimalPercent: async () => 50, bolehMenerobosDp: () => false }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/InpatientCashier", () => ({ InpatientCashier: ({ packages = [] }: { packages?: ClinicPackageOption[] }) => <div data-cashier>{packages[0]?.resep?.komponen.length ?? 0} full components</div> }));
import { InpatientPaymentPage } from "@/app/(app)/klinik/pembayaran/[visitId]/InpatientPaymentPage";
const rows = Array.from({ length: 501 }, (_, i) => ({ id: `component-${i}`, group_item_id: "package", component_item_id: `sku-${i}`, qty: 1, unit: "pcs", factor: 1, items: { name: "Paket Fiktif", is_active: true, item_type: "Grup" }, component: { id: `sku-${i}`, code: "SKU", name: `Bahan-${i}`, unit: "pcs", item_type: "Persediaan", is_active: true, tindakan_kategori: null } }));
function client() {
  return { rpc: async () => ({ error: null, data: { state: state.readOnly ? "SHIFT_REQUIRED" : "EDITABLE", snapshot: state.readOnly ? null : "snap", rows: [], history: [{ id: "issued", invoice_no: "INVOICE-LAMA", total: 500, received: 100, dp_amount: 100, paid_status: "DP", correction_pending: false, lines: [] }], receipts: [], applications: [], tax_settings: { mode_pkp: false, ppn_rate: 0 }, quote: state.readOnly ? null : { accounts: [], remaining: 0 } } }),
    from: (table: string) => {
      const q = { select: () => q, eq: () => q, order: () => q, maybeSingle: async () => ({ data: { role: "FINANCE" }, error: null }),
        range: async (from: number, to: number) => { expect(table).toBe("item_group_components"); state.ranges.push(from); return { data: state.partial && from > 0 ? [] : rows.slice(from, to + 1), count: rows.length, error: state.fail && from > 0 ? { message: "read failed" } : null }; } };
      return q;
    },
  };
}
async function render() { return renderToStaticMarkup(await InpatientPaymentPage({ db: client() as never, visitId: "visit", recordId: "stay", branchId: "branch", userId: "user", query: {}, patient: { photo: null, name: "Pasien Fiktif", species: "Kucing", owner: "Pemilik", phone: "", address: "", dokter: "Dokter", jenisLayanan: "Rawat Inap", noInvoice: "(baru)", tanggal: "2026-11-02" } })); }
beforeEach(() => { state.readOnly = false; state.fail = false; state.partial = false; state.ranges = []; });
it("loads the complete existing package recipe reader beyond the first page", async () => { const html = await render(); expect(html).toContain("501 full components"); expect(state.ranges).toEqual([0, 500]); });
it.each(["fail", "partial"] as const)("denies an editable cashier when package recipe read is %s", async mode => { state[mode] = true; const html = await render(); expect(html).toContain("belum dapat diverifikasi"); expect(html).not.toContain("data-cashier"); });
it("shift-required history remains read-only without requiring a recipe read", async () => { state.readOnly = true; state.fail = true; const html = await render(); expect(html).toContain("INVOICE-LAMA"); expect(html).toContain("DP awal tersimpan"); expect(html).toContain("Buka shift"); expect(html).not.toContain("data-cashier"); expect(state.ranges).toEqual([]); });
