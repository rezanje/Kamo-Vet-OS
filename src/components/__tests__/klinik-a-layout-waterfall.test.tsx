import { beforeEach, expect, it, vi } from "vitest";
import { roundTripClient, filterOf, reportWaterfall as report, type Call } from "@/lib/__tests__/helpers/round-trip-client";

// Klinik-A: the (app) layout renders next to every klinik page (and again on every
// router.refresh, e.g. Antrean's live refresh). Its reads must not queue behind each
// other, and the active-branch banner must reuse the branch catalogue it already read.
// Evidence = round-trip depth on a mocked client (request order), not live timing.
const BRANCH = "eb200000-0000-4000-8000-000000000001";
const s = vi.hoisted(() => ({ rt: null as null | ReturnType<typeof import("@/lib/__tests__/helpers/round-trip-client").roundTripClient>, role: "STAFF", shift: true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => s.rt!.client }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-kamo-operational-branch": "eb200000-0000-4000-8000-000000000001", "x-kamo-operational-mode": "klinik" }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
import AppLayout from "@/app/(app)/layout";

function respond(call: Call) {
  if (call.kind !== "from") return {};
  switch (call.name) {
    case "profiles": return { data: { full_name: "Pengguna Fiktif", role: s.role, is_active: true } };
    case "branches":
      return filterOf(call, "eq", "id") ? { data: { name: "Cabang A", code: "A", type: "KLINIK" } } : { data: [{ id: BRANCH, code: "A", name: "Cabang A", type: "KLINIK" }] };
    case "role_modules": return { data: [] };
    case "cashier_shifts": return { data: s.shift ? { id: "shift", branch_id: BRANCH, opening_balance: 0, opened_at: "2026-10-30T00:00:00Z", branches: { name: "Cabang A", code: "A" } } : null };
    default: return { data: [] };
  }
}
const render = async () => { s.rt = roundTripClient(respond); await AppLayout({ children: null }); return s.rt; };
beforeEach(() => { s.role = "STAFF"; s.shift = true; });

it.each(["STAFF", "DOCTOR"])("%s: layout session, profile, menu rules, branch catalogue and shift take at most 2 round trips", async (role) => {
  s.role = role;
  const rt = await render();
  report(`layout (app) ${role}`, rt);
  expect(rt.depth()).toBeLessThanOrEqual(2);
  // banner cabang aktif memakai katalog cabang yang sudah dibaca, bukan bacaan kedua
  expect(rt.calls.filter((c) => c.name === "branches")).toHaveLength(1);
});

it("still reads the open shift for a STAFF account", async () => {
  const rt = await render();
  expect(rt.calls.some((c) => c.name === "cashier_shifts")).toBe(true);
});
