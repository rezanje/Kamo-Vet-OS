import { beforeEach, expect, it, vi } from "vitest";
import { roundTripClient, filterOf, paged, fictionalCatalogue, reportWaterfall as report, type Call } from "@/lib/__tests__/helpers/round-trip-client";

// Klinik-A: Pembayaran (open, and the paid view rendered right after "Bayar & Selesai")
// must start independent reads together and must not load the full sales catalogue when
// no editable cart is shown. Evidence = round-trip depth on a mocked client, not live timing.
const s = vi.hoisted(() => ({
  rt: null as null | ReturnType<typeof import("@/lib/__tests__/helpers/round-trip-client").roundTripClient>,
  invoice: null as null | Record<string, unknown>, inpatient: false, shift: true, correctable: false,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => s.rt!.client }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm", () => ({ PembayaranForm: () => null }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/InpatientCashier", () => ({ InpatientCashier: () => null }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ admitInpatient: vi.fn() }));
import Page from "@/app/(app)/klinik/pembayaran/[visitId]/page";

const catalogue = fictionalCatalogue();
const visit = { id: "visit-a", status: "Pembayaran", poli: "Poli Umum", dokter: "Drh Fiksi", created_at: "2026-10-30T02:00:00Z", branch_id: "branch-a", customer_id: "cust-a", doctor_id: "doc-a", service_provider_id: null, pets: { name: "Milo", species: "Kucing", weight: 4, photo_url: null }, customers: { name: "Pemilik Fiksi", phone: "0800", address: null, review_catatan: null, customer_review_statuses: null } };
function respond(call: Call) {
  if (call.kind === "auth") return {};
  if (call.kind === "rpc") {
    // Integrasi D: versi keranjang rawat jalan (sidik baris resep tertunda).
    if (call.name === "clinic_outpatient_cart_version") return { data: `v1:${"0".repeat(32)}` };
    if (call.name === "clinic_invoice_correction_eligible") return { data: s.correctable };
    if (call.name === "clinic_manual_invoice_units_supported") return { data: true };
    if (call.name === "clinic_demo_care_staff") return { data: [] };
    if (call.name === "clinic_read_inpatient_cashier") return { data: { state: "SHIFT_REQUIRED", history: [], receipts: [], applications: [], quote: null, snapshot: null } };
    return { data: null };
  }
  switch (call.name) {
    case "visits":
      if (filterOf(call, "eq", "id") === "visit-a") return { data: { ...visit, customer_id: "cust-a" } };
      return { data: [{ id: "visit-a", status: "Pembayaran", created_at: visit.created_at, branch_id: "branch-a", customer_id: "cust-a", pets: { name: "Milo" }, invoices: s.invoice ? [s.invoice] : [] }] };
    case "medical_records": return { data: { id: "record-a", catatan_resep: null } };
    case "inpatient_records": return { data: s.inpatient ? { id: "inpat-a", consent_id: null, discharged_at: null } : null };
    case "invoices": return { data: s.invoice ? [s.invoice] : [] };
    case "prescription_items": return { data: [{ id: "rx-a", nama_obat: "Amoxicillin", qty: 1, harga: 1000, jenis: "obat", kategori: null, item_id: catalogue[1].id, satuan: "pcs", compound_recipe_id: null }] };
    case "pajak_settings": return { data: { mode_pkp: false, ppn_rate: 11 } };
    case "profiles": return { data: { role: "ADMIN", full_name: "Kasir Fiksi", is_active: true } };
    case "cashier_shifts": return { data: s.shift ? { id: "shift-a", branch_id: "branch-a", opening_balance: 0, opened_at: "2026-10-30T00:00:00Z", branches: { name: "Cabang A", code: "A" } } : null };
    case "items": return paged(call, catalogue);
    case "warehouses": return { data: { id: "wh-a" } };
    case "branches": return { data: { type: "KLINIK" } };
    default: return undefined;
  }
}
const open = async (query: Record<string, string> = {}) => {
  s.rt = roundTripClient(respond);
  await Page({ params: Promise.resolve({ visitId: "visit-a" }), searchParams: Promise.resolve(query) });
  return s.rt;
};
const paid = { id: "inv-a", invoice_no: "INV/1", subtotal: 1000, discount: 0, tax: 0, total: 1000, dp_amount: 0, dp_date: null, paid_status: "Lunas", metode_bayar: "Tunai", paid_at: "2026-10-30T03:00:00Z", reissued_from: null, correction_pending: false, created_at: "2026-10-30T03:00:00Z", request_key: "k", salesperson_id: null, cashier_name: "Kasir Fiksi", service_pricing_version: 1 };

beforeEach(() => { s.invoice = null; s.inpatient = false; s.shift = true; s.correctable = false; });

it("opening an unpaid outpatient payment starts its independent reads together", async () => {
  const rt = await open();
  report("pembayaran open (no invoice yet)", rt);
  // resep dibaca sekali (dulu dua kali: baris tagihan + kategori consent)
  expect(rt.calls.filter((c) => c.name === "prescription_items")).toHaveLength(1);
  expect(rt.calls.filter((c) => c.kind === "auth")).toHaveLength(1);
  // Sebelum: 37 putaran berurutan. Sisa rantai = katalog 3.600 SKU (3) + gudang (1) +
  // stok/satuan/harga (3) + bekal promo (2) di helper bersama yang tidak diubah paket ini.
  expect(rt.depth()).toBeLessThanOrEqual(11);
});

it("the paid view shown after Bayar & Selesai does not load the sales catalogue it never shows", async () => {
  s.invoice = paid;
  const rt = await open({ success: "bayar" });
  report("pembayaran paid view (after Bayar & Selesai)", rt);
  expect(rt.calls.some((c) => c.name === "items")).toBe(false);
  expect(rt.calls.some((c) => ["stock", "item_units", "item_branch_prices"].includes(c.name))).toBe(false);
  expect(rt.depth()).toBeLessThanOrEqual(5); // sebelum: 36
});

it("a correctable invoice still gets the catalogue for its editable cart", async () => {
  s.invoice = { ...paid, paid_status: "Belum Lunas" }; s.correctable = true;
  const rt = await open();
  expect(rt.calls.filter((c) => c.name === "items").length).toBeGreaterThan(1);
});

it("inpatient payment reaches the inpatient cashier reader within 3 round trips", async () => {
  s.inpatient = true;
  const rt = await open();
  report("pembayaran inpatient (cashier reader)", rt);
  const reader = rt.calls.find((c) => c.kind === "rpc" && c.name === "clinic_read_inpatient_cashier")!;
  expect(reader.wave).toBeLessThanOrEqual(3);
});

it("still sends an unpaid payment without an open shift to the shift page", async () => {
  s.shift = false;
  await expect(open()).rejects.toThrow(/^REDIRECT \/klinik\/shift/);
});
