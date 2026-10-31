import { beforeEach, expect, it, vi } from "vitest";
import { roundTripClient, filterOf, paged, fictionalCatalogue, reportWaterfall as report, type Call } from "@/lib/__tests__/helpers/round-trip-client";

// Klinik-A: opening Rekam Medis must not queue reads that only need the visit id /
// record id behind each other, and must not read the same invoice twice.
// Evidence = round-trip depth on a mocked client (request order), not live timing.
const s = vi.hoisted(() => ({ rt: null as null | ReturnType<typeof import("@/lib/__tests__/helpers/round-trip-client").roundTripClient>, status: "Pembayaran", invoice: true }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => s.rt!.client }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/RekamForm", () => ({ RekamForm: () => null }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/RacikanInline", () => ({ RacikanInline: () => null }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ admitInpatient: vi.fn(), continueToInpatient: vi.fn() }));
import Page from "@/app/(app)/klinik/rekam-medis/[visitId]/page";

const visit = () => ({
  id: "visit-a", pet_id: "pet-a", branch_id: "branch-a", legacy_source_key: null, poli: "Poli Umum", status: s.status,
  dokter: "Drh Fiksi", doctor_id: "doc-a", keluhan: "Fiksi", created_at: "2026-10-30T02:00:00Z", source: null,
  checked_in_at: null, service_started_at: null, service_finished_at: null, checked_out_at: null, service_provider_id: null,
  pets: { name: "Milo", species: "Kucing", breed: null, weight: 4, photo_url: null, created_at: "2026-01-01T00:00:00Z" },
  customers: { name: "Pemilik Fiksi", phone: "0800", address: null, tier: null },
});
function respond(call: Call) {
  if (call.kind === "auth") return {};
  if (call.kind === "rpc") return { data: call.name === "clinic_can_add_record_addendum" || call.name === "clinic_can_correct_record" };
  switch (call.name) {
    case "visits":
      if (filterOf(call, "eq", "id") === "visit-a" && call.single) {
        return { data: call.ops.some(([op, args]) => op === "select" && String(args[0]).startsWith("id, pet_id")) ? visit() : { customer_id: "cust-a", branch_id: "branch-a", created_at: "2026-10-30T02:00:00Z", continued_from_visit_id: null } };
      }
      return { data: filterOf(call, "eq", "customer_id") ? [{ id: "visit-a", status: s.status, pets: { name: "Milo" } }, { id: "visit-b", status: "Menunggu", pets: { name: "Luna" } }] : [] };
    case "medical_records": return { data: [{ id: "record-a", visit_id: "visit-a", anamnesis: "A", diagnosis: "D", therapy: "T", clinical_revision: 1 }] };
    case "invoices": return { data: s.invoice ? [{ id: "inv-a", voided_at: null, paid_status: "Belum Lunas" }] : [] };
    case "profiles": return { data: { role: "DOCTOR", is_active: true } };
    // Catalogue sized like production (3.600 SKUs, 500 per page) plus 40 finished compound SKUs.
    case "items": return paged(call, call.ops.some(([op]) => op === "or") ? compounds : catalogue);
    case "warehouses": return { data: { id: "wh-a" } };
    case "branches": return { data: { type: "KLINIK" } };
    default: return undefined;
  }
}
const catalogue = fictionalCatalogue();
const compounds = fictionalCatalogue(40, "racik");
const open = async () => { s.rt = roundTripClient(respond); await Page({ params: Promise.resolve({ visitId: "visit-a" }), searchParams: Promise.resolve({}) }); return s.rt; };

beforeEach(() => { s.status = "Pembayaran"; s.invoice = true; });

it("saved record awaiting payment: reads the invoice once and needs at most 4 sequential round trips", async () => {
  const rt = await open();
  report("rekam-medis saved+invoice", rt);
  expect(rt.calls.filter((c) => c.name === "invoices" && c.ops.some(([op, a]) => op === "select" && a[0] === "id"))).toHaveLength(1);
  // addenda, continuation and the active-invoice check need only ids known after the first wave
  const wave = (name: string) => rt.calls.find((c) => c.name === name)!.wave;
  expect(wave("clinic_record_addenda")).toBeLessThanOrEqual(2);
  expect(rt.depth()).toBeLessThanOrEqual(4);
});

it("examination form: compound SKUs and continuation do not wait for the whole catalogue", async () => {
  s.status = "Diperiksa"; s.invoice = false;
  const rt = await open();
  report("rekam-medis exam form", rt);
  const continuation = rt.calls.filter((c) => c.name === "visits" && filterOf(c, "eq", "continued_from_visit_id") === "visit-a");
  expect(continuation).toHaveLength(1);
  expect(continuation[0].wave).toBeLessThanOrEqual(2);
  const compound = rt.calls.find((c) => c.name === "items" && c.ops.some(([op]) => op === "or"))!;
  const lastCataloguePage = Math.max(...rt.calls.filter((c) => c.name === "items" && !c.ops.some(([op]) => op === "or")).map((c) => c.wave));
  expect(compound.wave).toBeLessThan(lastCataloguePage);
  // Sisa rantai = gudang + detail stok/satuan/harga 3.640 SKU (19 batch, 6 sekaligus) di
  // loadClinicSkuDetails — tidak diubah di paket ini. Sebelum: 13 putaran.
  expect(rt.depth()).toBeLessThanOrEqual(9);
});

it("still checks the addendum permission in the database before offering it", async () => {
  const rt = await open();
  expect(rt.calls.some((c) => c.kind === "rpc" && c.name === "clinic_can_add_record_addendum")).toBe(true);
  expect(rt.calls.some((c) => c.kind === "rpc" && c.name === "clinic_can_correct_record")).toBe(true);
});
