import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ allowed: ["branch"] as string[] | null, loaded: [] as string[], props: {} as Record<string, unknown>, itemSelections: [] as string[] }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("@/app/(app)/pos/transaksi/PosClient", () => ({ PosClient: (props: Record<string, unknown>) => { state.props = props; return null; } }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => state.allowed, canUseBranch: (allowed: string[] | null, branchId: string) => allowed === null || allowed.includes(branchId) }));
vi.mock("@/lib/service-performers-server", () => ({ loadServiceStaff: async (_client: unknown, branchId: string) => { state.loaded.push(branchId); return [{ id: `${branchId}-staff`, nama: `Staf ${branchId}`, jabatan: "Groomer" }]; } }));
vi.mock("@/lib/satuan", () => ({ loadItemUnits: async () => new Map(), unitOptions: () => [] }));
vi.mock("@/lib/promo-hitung", () => ({ loadPromoAktif: async () => [] }));
vi.mock("@/lib/harga-golongan", () => ({ loadAturanDiskon: async () => [], loadInfoBarang: async () => new Map() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from(table: string) {
    const data = table === "branches" ? [{ id: "branch", name: "Cabang", code: "BR" }, { id: "other", name: "Lain", code: "B2" }]
      : table === "items" ? [{ id: "service", name: "Jasa", item_type: "Jasa", unit: "pcs", sell_price: 100, target_species: "Universal" }] : [];
    const query = { select: (fields: string) => { if (table === "items") state.itemSelections.push(fields); return query; }, eq: () => query, in: () => query, order: () => query, range: () => query,
      maybeSingle: async () => ({ data: null }), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, count: data.length, error: null }).then(resolve),
    }; return query;
  },
}) }));
import Page from "@/app/(app)/pos/transaksi/page";
beforeEach(() => { state.allowed = ["branch"]; state.loaded = []; state.props = {}; state.itemSelections = []; });
async function render() { renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) })); }
it("exposes staff only for the actor's allowed branches and preserves existing branch visibility", async () => {
  await render();
  expect(state.loaded).toEqual(["branch"]);
  expect(state.props.serviceStaffByBranch).toEqual({ branch: [{ id: "branch-staff", nama: "Staf branch", jabatan: "Groomer" }] });
  expect(state.props.branches).toHaveLength(2);
  expect(state.itemSelections[0]).toContain("item_type");
  expect(state.props.items).toEqual([expect.objectContaining({ item_type: "Jasa" })]);
});
it("loads each visible branch separately for an actor with all branch access", async () => {
  state.allowed = null; await render();
  expect(state.loaded).toEqual(["branch", "other"]);
  expect(Object.keys(state.props.serviceStaffByBranch as object)).toEqual(["branch", "other"]);
});
it("does not fetch any employee choices when branch grants are empty", async () => {
  state.allowed = []; await render();
  expect(state.loaded).toEqual([]); expect(state.props.serviceStaffByBranch).toEqual({});
});
