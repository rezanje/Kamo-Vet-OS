import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { roundTripClient, filterOf, reportWaterfall as report, type Call } from "@/lib/__tests__/helpers/round-trip-client";

// Klinik-A: every klinik navigation and Server Action first passes the session
// middleware, and Antrean re-checks the operational branch. The branch/account/shift
// checks must still all run, but their independent reads must not wait for each other.
// Evidence = round-trip depth on a mocked client (request order), not live timing.
const BRANCH = "eb200000-0000-4000-8000-000000000001";
const s = vi.hoisted(() => ({
  rt: null as null | ReturnType<typeof import("@/lib/__tests__/helpers/round-trip-client").roundTripClient>,
  role: "STAFF", grants: [] as string[], branchActive: true, shiftBranch: null as string | null,
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => s.rt!.client }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => s.rt!.client }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-kamo-operational-branch": "eb200000-0000-4000-8000-000000000001", "x-kamo-operational-mode": "klinik" }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/app/(app)/klinik/antrian/LiveRefresh", () => ({ LiveRefresh: () => null }));
import { updateSession } from "@/lib/supabase/middleware";
import AntrianPage from "@/app/(app)/klinik/antrian/page";

function respond(call: Call) {
  if (call.kind !== "from") return {};
  switch (call.name) {
    case "profiles": return { data: { role: s.role, is_active: true } };
    case "role_modules": return { data: [] };
    case "role_capabilities": return { data: null };
    case "user_branches": return { data: s.grants.map((branch_id) => ({ branch_id })) };
    case "branches":
      return filterOf(call, "eq", "id") ? { data: { id: BRANCH, name: "Cabang A", code: "A", type: "KLINIK", is_active: s.branchActive } } : { data: [{ code: "A", name: "Cabang A", type: "KLINIK" }] };
    case "cashier_shifts": return { data: s.shiftBranch ? { id: "shift", branch_id: s.shiftBranch, opening_balance: 0, opened_at: "2026-10-30T00:00:00Z", branches: { name: "X", code: "X" } } : null };
    default: return { data: [] };
  }
}
const navigate = async (path = "/klinik/antrian") => {
  s.rt = roundTripClient(respond, { userId: "verified-user" });
  const request = new NextRequest(`https://vetos.test${path}`);
  request.cookies.set("kamo-branch-klinik", JSON.stringify({ userId: "verified-user", branchId: BRANCH }));
  return { response: await updateSession(request), rt: s.rt };
};

beforeEach(() => { s.role = "STAFF"; s.grants = [BRANCH]; s.branchActive = true; s.shiftBranch = null; });

it("middleware: a staff klinik navigation verifies account, rules, branch grant and shift in at most 2 round trips", async () => {
  const { response, rt } = await navigate();
  report("middleware klinik navigation (STAFF)", rt);
  expect(response.headers.get("x-middleware-request-x-kamo-operational-branch")).toBe(BRANCH);
  for (const table of ["profiles", "role_modules", "role_capabilities", "user_branches", "branches", "cashier_shifts"]) {
    expect(rt.calls.some((c) => c.name === table)).toBe(true);
  }
  expect(rt.depth()).toBeLessThanOrEqual(2);
});

it("middleware: the guards still refuse a revoked grant, an inactive branch and an open shift elsewhere", async () => {
  s.grants = [];
  expect((await navigate()).response.status).toBe(303);
  s.grants = [BRANCH]; s.branchActive = false;
  expect((await navigate()).response.status).toBe(303);
  s.branchActive = true; s.shiftBranch = "eb200000-0000-4000-8000-000000000002";
  expect((await navigate()).response.status).toBe(303);
  s.shiftBranch = BRANCH;
  expect((await navigate()).response.headers.get("x-middleware-next")).toBe("1");
});

it("Antrean: branch guard, branch labels and voucher reminders do not queue behind each other", async () => {
  s.rt = roundTripClient(respond, { userId: "verified-user" });
  await AntrianPage({ searchParams: Promise.resolve({}) });
  report("antrean open (STAFF, one branch)", s.rt);
  const visits = s.rt.calls.filter((c) => c.name === "visits");
  expect(visits).toHaveLength(3);
  expect(s.rt.depth()).toBeLessThanOrEqual(4);
});

it("Antrean: still refuses to render when the account lost the branch grant", async () => {
  s.grants = [];
  s.rt = roundTripClient(respond, { userId: "verified-user" });
  await expect(AntrianPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/REDIRECT \/mulai\/cabang/);
  expect(s.rt.calls.some((c) => c.name === "visits")).toBe(false);
});
