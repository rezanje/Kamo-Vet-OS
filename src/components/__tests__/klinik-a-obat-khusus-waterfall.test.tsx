import { expect, it, vi } from "vitest";
import { roundTripClient, filterOf, paged, fictionalCatalogue, reportWaterfall as report, type Call } from "@/lib/__tests__/helpers/round-trip-client";

// Klinik-A: OBAT KHUSUS (rawat inap) was already parallelised by U07; this guards that
// depth and records it for the report. Its remaining chain is the shared clinic catalogue
// (3.600 SKUs + stock/units/branch prices). Evidence = round-trip depth on a mocked client.
const s = vi.hoisted(() => ({ rt: null as null | ReturnType<typeof import("@/lib/__tests__/helpers/round-trip-client").roundTripClient> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => s.rt!.client }));
vi.mock("@/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm", () => ({ CatatanForm: () => null }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ addDailyLogPos: vi.fn() }));
import Page from "@/app/(app)/klinik/rawat-inap/[id]/obat-khusus/page";

const catalogue = fictionalCatalogue();
function respond(call: Call) {
  if (call.kind !== "from") return {};
  switch (call.name) {
    case "inpatient_records":
      return filterOf(call, "eq", "id") ? { data: { id: "stay-a", condition_status: "Stabil", doctor_name: "Drh", admitted_at: "2026-10-30T00:00:00Z", visit_id: "visit-a", visits: { created_at: "2026-10-30T00:00:00Z", branch_id: "branch-a", doctor_id: null, pets: { name: "Milo" }, customers: { name: "Pemilik" } } } } : { data: [] };
    case "items": return paged(call, call.ops.some(([op]) => op === "or") ? [] : catalogue);
    case "profiles": return { data: { role: "DOCTOR", is_active: true } };
    case "warehouses": return { data: { id: "wh-a" } };
    case "branches": return { data: { type: "KLINIK" } };
    default: return undefined;
  }
}

it("OBAT KHUSUS keeps its U07 depth: only the shared catalogue chain remains (≤ 7 round trips)", async () => {
  s.rt = roundTripClient(respond);
  await Page({ params: Promise.resolve({ id: "stay-a" }), searchParams: Promise.resolve({}) });
  report("rawat inap OBAT KHUSUS (billables)", s.rt);
  expect(s.rt.calls.find((c) => c.name === "inpatient_records")!.wave).toBe(1);
  expect(s.rt.depth()).toBeLessThanOrEqual(7);
});
