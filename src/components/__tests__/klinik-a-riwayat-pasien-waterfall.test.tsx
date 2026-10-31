import { expect, it, vi } from "vitest";
import { roundTripClient, filterOf, reportWaterfall as report, type Call } from "@/lib/__tests__/helpers/round-trip-client";

// Klinik-A: the patient history page (Antrean → pasien) reads the operational visit
// list, the cross-branch clinical history and the owner's transaction summary; all three
// only need ids from the opened visit. Evidence = round-trip depth on a mocked client.
const s = vi.hoisted(() => ({ rt: null as null | ReturnType<typeof import("@/lib/__tests__/helpers/round-trip-client").roundTripClient> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: vi.fn() }), headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => s.rt!.client }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => s.rt!.client }));
import Page from "@/app/(app)/klinik/antrian/[id]/page";

const pet = { id: "pet-a", name: "Milo", species: "Kucing", created_at: "2026-01-01T00:00:00Z" };
function respond(call: Call) {
  if (call.kind === "rpc" && call.name === "clinic_patient_clinical_history") {
    return { data: { pet_id: "pet-a", visits: [{ id: "visit-a", pet_id: "pet-a", branch_id: "branch-a", branch_name: "Cabang A", created_at: "2026-10-30T02:00:00Z", poli: "Poli Umum", dokter: "Drh", keluhan: "K", can_open: true, records: [] }] } };
  }
  if (call.kind !== "from") return {};
  if (call.name === "visits" && filterOf(call, "eq", "id") === "visit-a") {
    return { data: { id: "visit-a", pet_id: "pet-a", created_at: "2026-10-30T02:00:00Z", pets: pet, customers: { id: "cust-a", name: "Pemilik", points: 0 }, branches: { name: "Cabang A", code: "A" } } };
  }
  if (call.name === "visits") return { data: [{ id: "visit-a", poli: "Poli Umum", dokter: "Drh", keluhan: "K", created_at: "2026-10-30T02:00:00Z", medical_records: [], invoices: [] }] };
  return { data: [] };
}

it("opens the patient history with operational, clinical and transaction reads together", async () => {
  s.rt = roundTripClient(respond);
  await Page({ params: Promise.resolve({ id: "visit-a" }) });
  report("riwayat pasien (antrean → pasien)", s.rt);
  const rpc = s.rt.calls.find((c) => c.kind === "rpc" && c.name === "clinic_patient_clinical_history")!;
  const sales = s.rt.calls.find((c) => c.name === "sales")!;
  expect(rpc.wave).toBe(2);
  expect(sales.wave).toBe(2);
  expect(s.rt.depth()).toBeLessThanOrEqual(3);
});
