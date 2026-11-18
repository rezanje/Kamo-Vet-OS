// Kasir: isian awal slot Dokter untuk kunjungan Grooming yang punya dokter pemeriksa (visits.pemeriksa_id).
// Aturan: pemeriksa dipakai HANYA bila cabang memang mewajibkan dokter pada Grooming; selain itu perilaku lama persis.
import { beforeEach, expect, it, vi } from "vitest";
import { roundTripClient, filterOf, paged, fictionalCatalogue, type Call } from "@/lib/__tests__/helpers/round-trip-client";

// Klinik-A: Pembayaran (open, and the paid view rendered right after "Bayar & Selesai")
// must start independent reads together and must not load the full sales catalogue when
// no editable cart is shown. Evidence = round-trip depth on a mocked client, not live timing.
const s = vi.hoisted(() => ({
  rt: null as null | ReturnType<typeof import("@/lib/__tests__/helpers/round-trip-client").roundTripClient>,
  invoice: null as null | Record<string, unknown>, inpatient: false, shift: true, correctable: false, visit: {} as Record<string, unknown>, doctorRequired: null as boolean | null,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => s.rt!.client }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm", () => ({ PembayaranForm: () => null }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/InpatientCashier", () => ({ InpatientCashier: () => null }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ admitInpatient: vi.fn() }));
import Page from "@/app/(app)/klinik/pembayaran/[visitId]/page";
import { PembayaranForm } from "@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm";

const catalogue = fictionalCatalogue();
// A saved 1.000 invoice has its persisted source line, not an empty detail read.
const invoiceItems = [{ id: "line-a", deskripsi: "Amoxicillin", qty: 1, harga: 1000, jenis: "obat", item_id: catalogue[1].id, diskon_persen: 0, compound_recipe_id: null, prescription_item_id: "rx-a", satuan: "pcs" }];
const baseVisit = { id: "visit-a", status: "Pembayaran", poli: "Poli Umum", dokter: "Drh Fiksi", created_at: "2026-10-30T02:00:00Z", branch_id: "branch-a", customer_id: "cust-a", doctor_id: "doc-a", service_provider_id: null, pets: { name: "Milo", species: "Kucing", weight: 4, photo_url: null }, customers: { name: "Pemilik Fiksi", phone: "0800", address: null, review_catatan: null, customer_review_statuses: null } };
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
      if (filterOf(call, "eq", "id") === "visit-a") return { data: { ...s.visit, customer_id: "cust-a" } };
      return { data: [{ id: "visit-a", status: "Pembayaran", created_at: baseVisit.created_at, branch_id: "branch-a", customer_id: "cust-a", pets: { name: "Milo" }, invoices: s.invoice ? [s.invoice] : [] }] };
    case "medical_records": return { data: { id: "record-a", catatan_resep: null } };
    case "inpatient_records": return { data: s.inpatient ? { id: "inpat-a", consent_id: null, discharged_at: null } : null };
    case "invoices": return { data: s.invoice ? [s.invoice] : [] };
    case "invoice_items": return paged(call, invoiceItems);
    case "prescription_items": return { data: [{ id: "rx-a", nama_obat: "Amoxicillin", qty: 1, harga: 1000, jenis: "obat", kategori: null, item_id: catalogue[1].id, satuan: "pcs", compound_recipe_id: null }] };
    case "pajak_settings": return { data: { mode_pkp: false, ppn_rate: 11 } };
    case "profiles": return { data: { role: "ADMIN", full_name: "Kasir Fiksi", is_active: true } };
    case "cashier_shifts": return { data: s.shift ? { id: "shift-a", branch_id: "branch-a", opening_balance: 0, opened_at: "2026-10-30T00:00:00Z", branches: { name: "Cabang A", code: "A" } } : null };
    case "items": return paged(call, catalogue);
    case "warehouses": return { data: { id: "wh-a" } };
    case "branches": return { data: { type: "KLINIK" } };
    case "branch_grooming_rules": return { data: s.doctorRequired === null ? null : { doctor_required: s.doctorRequired } };
    default: return undefined;
  }
}

function cariForm(node: unknown): Record<string, unknown> | null {
  let out: Record<string, unknown> | null = null;
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object" || out) return;
    if (Array.isArray(n)) return n.forEach(walk);
    const el = n as { type?: unknown; props?: Record<string, unknown> };
    if (el.type === PembayaranForm) { out = el.props!; return; }
    if (el.props) walk(el.props.children);
  };
  walk(node);
  return out;
}
const buka = async () => { s.rt = roundTripClient(respond); return cariForm(await Page({ params: Promise.resolve({ visitId: "visit-a" }), searchParams: Promise.resolve({}) })); };
const grooming = (o: Record<string, unknown> = {}) => ({ ...baseVisit, poli: "Grooming", dokter: "Agung", doctor_id: "groomer-a", pemeriksa_id: "dokter-p", ...o });

beforeEach(() => { s.invoice = null; s.inpatient = false; s.shift = true; s.correctable = false; s.visit = { ...baseVisit }; s.doctorRequired = null; });

it("Grooming + pemeriksa + cabang klinik (wajib dokter bawaan): slot Dokter kasir berangkat dari pemeriksa, bukan groomer", async () => {
  s.visit = grooming();
  const form = await buka();
  expect(form).not.toBeNull(); expect(form!.visitDoctorId).toBe("dokter-p");
});
it("cabang yang TIDAK mewajibkan dokter pada Grooming: perilaku lama (tidak ada atribusi baru diam-diam)", async () => {
  s.visit = grooming(); s.doctorRequired = false;
  expect((await buka())!.visitDoctorId).toBe("groomer-a");
});
it("Grooming tanpa pemeriksa: perilaku lama persis", async () => {
  s.visit = grooming({ pemeriksa_id: null });
  expect((await buka())!.visitDoctorId).toBe("groomer-a");
});
it("poli lain mengabaikan pemeriksa: dokter PJ kunjungan", async () => {
  s.visit = { ...baseVisit, poli: "Poli Umum", doctor_id: "doc-a", pemeriksa_id: "dokter-p" };
  expect((await buka())!.visitDoctorId).toBe("doc-a");
});
it("tidak menulis apa pun ke database (hanya mengisi awal layar)", async () => {
  s.visit = grooming(); await buka();
  expect(s.rt!.calls.some((c) => c.kind === "rpc" ? /^(clinic_(save|post|edit|void)|update_|insert_)/.test(c.name) : c.ops.some(([op]) => ["insert", "update", "upsert", "delete"].includes(op)))).toBe(false);
});
