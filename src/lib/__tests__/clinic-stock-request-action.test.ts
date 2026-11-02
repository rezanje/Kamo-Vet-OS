import { beforeEach, expect, it, vi } from "vitest";

// Anisa 2 Nov 2026: clinic requests to a DC / other-branch warehouse go through the checked RPC.
const state = vi.hoisted(() => ({ rpc: vi.fn(), writes: [] as string[], shift: true }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => state.shift ? { id: "shift-k", branch_id: "clinic-a" } : null }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "PRM-LEGACY" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "user-a" } } }) },
  rpc: state.rpc,
  from: (table: string) => {
    const query = {
      select: () => query, in: () => query, eq: () => query, order: () => query, range: () => query,
      insert: () => { state.writes.push(table); return query; },
      single: async () => ({ data: { id: "request-legacy" }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "items" ? [{ id: "item-a", name: "Syringe", unit: "pcs", item_type: "Persediaan" }] : [], error: null }).then(resolve),
    };
    return query;
  },
}) }));
import { buatPermintaanKlinik } from "@/app/(app)/klinik/permintaan/actions";

const key = "c1000000-0000-4000-8000-000000000001";
function form(values: Record<string, string> = {}) {
  const data = new FormData();
  Object.entries({ to_warehouse_id: "dc-vet", request_key: key, priority: "tinggi", catatan: " stok tipis ",
    items: JSON.stringify([{ item_id: "item-a", qty_diminta: 5, satuan: "pcs", catatan: "", cari: "Syringe" }, { item_id: "", qty_diminta: 1, satuan: "", catatan: "", cari: "" }]),
    ...values }).forEach(([name, value]) => data.set(name, value));
  return data;
}
const tujuan = async (data: FormData) => { try { await buatPermintaanKlinik(data); } catch (error) { return decodeURIComponent((error as Error).message); } return ""; };
beforeEach(() => { state.rpc.mockReset(); state.rpc.mockResolvedValue({ data: "request-a", error: null }); state.writes.length = 0; state.shift = true; });

it("creates the clinic request through one checked RPC from the open clinic shift branch", async () => {
  expect(await tujuan(form({ from_branch_id: "foreign" }))).toContain("/klinik/permintaan?success=1");
  expect(state.writes).toEqual([]);
  expect(state.rpc).toHaveBeenCalledWith("create_clinic_stock_request_atomic", {
    p_key: key, p_branch_id: "clinic-a", p_to_warehouse_id: "dc-vet", p_priority: "tinggi", p_notes: "stok tipis",
    p_items: [{ item_id: "item-a", qty_diminta: 5, satuan: "pcs", catatan: "" }],
  });
});

it("reports a database rejection instead of falling back to the browser insert", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Gudang tujuan tidak aktif" } });
  const url = await tujuan(form());
  expect(url).toContain("/klinik/permintaan/baru?error=Gudang tujuan tidak aktif");
  expect(state.writes).toEqual([]);
});

it("keeps the legacy save when the database routine is not installed yet", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
  expect(await tujuan(form())).toContain("/klinik/permintaan?success=1");
  expect(state.writes).toEqual(["stock_requests", "stock_request_items"]);
});

it("maps an unsupported priority to normal (database accepts normal/tinggi only)", async () => {
  await tujuan(form({ priority: "rendah" }));
  expect(state.rpc.mock.calls[0][1].p_priority).toBe("normal");
});
