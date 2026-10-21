import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), receipt: vi.fn(), writes: [] as string[], auth: true, shift: true }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => state.shift ? { id: "shift-a", branch_id: "branch-a" } : null }));
vi.mock("@/lib/terima-permintaan", () => ({ prosesTerimaPermintaan: state.receipt }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "PRM-COLLISION" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.auth ? { id: "user-a" } : null } }) },
  rpc: state.rpc,
  from: (table: string) => {
    const query = {
      select: () => query, in: () => query, eq: () => query, order: () => query, range: () => query,
      insert: () => { state.writes.push(table); return query; },
      single: async () => ({ data: { id: "request-a" }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "items" ? [{ id: "item-a", name: "Obat A", unit: "pcs", item_type: "Persediaan" }] : [], error: null }).then(resolve),
    };
    return query;
  },
}) }));
import { buatPermintaanKasir, terimaBarang } from "@/app/kasir/persediaan/actions";

const key = "f1000000-0000-4000-8000-000000000001";
function form(values: Record<string, string> = {}) {
  const data = new FormData();
  Object.entries({ to_warehouse_id: "dc-a", request_key: key, draft_key: key, draft_scope: "cashier-stock-request:branch-a", priority: "tinggi", catatan: " stok tipis ",
    items: JSON.stringify([{ item_id: "item-a", qty_diminta: 2, satuan: "pcs", catatan: "segera", nama: "FORGED", faktor: 999 }]), ...values }).forEach(([name, value]) => data.set(name, value));
  return data;
}
beforeEach(() => { state.rpc.mockReset(); state.rpc.mockResolvedValue({ data: "request-a", error: null }); state.receipt.mockReset(); state.receipt.mockResolvedValue({ ok: true, receiptNumber: "TRM-1", selisih: 0 }); state.writes.length = 0; state.auth = true; state.shift = true; });

it("creates header and all items through one checked RPC using the authenticated shift branch", async () => {
  await expect(buatPermintaanKasir(form({ from_branch_id: "foreign-branch", draft_scope: "forged-scope" }))).rejects.toThrow(`/kasir/persediaan?tab=permintaan&success=1&draft_done=${key}&draft_scope=cashier-stock-request%3Abranch-a`);
  expect(state.writes).toEqual([]);
  expect(state.rpc).toHaveBeenCalledWith("create_cashier_stock_request_atomic", {
    p_key: key, p_branch_id: "branch-a", p_to_warehouse_id: "dc-a", p_priority: "tinggi", p_notes: "stok tipis",
    p_items: [{ item_id: "item-a", qty_diminta: 2, satuan: "pcs", catatan: "segera" }],
  });
});

it("reports a rejected atomic save without success or draft acknowledgement", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "Gudang tujuan tidak aktif" } });
  let destination = "";
  try { await buatPermintaanKasir(form()); } catch (error) { destination = (error as Error).message; }
  expect(decodeURIComponent(destination)).toContain("Gudang tujuan tidak aktif");
  expect(destination).toContain("/kasir/persediaan/baru?error=");
  expect(destination).not.toContain("draft_done"); expect(state.writes).toEqual([]);
});

it("does not acknowledge a save without a confirmed document result", async () => {
  state.rpc.mockResolvedValue({ data: null, error: null });
  await expect(buatPermintaanKasir(form())).rejects.toThrow(/baru\?error=/);
});

it("posts cashier receipt through the atomic helper and acknowledges only a confirmed result", async () => {
  const data = form({ request_id: "request-a", items: JSON.stringify([{ id: "line-a", qty_diterima: 2, kondisi: "baik", notes: "" }]) });
  await expect(terimaBarang(data)).rejects.toThrow(
    `/kasir/persediaan?tab=penerimaan&success=terima&trm=TRM-1&selisih=0&draft_done=${key}&draft_scope=cashier-stock-request%3Abranch-a`,
  );
  expect(state.receipt).toHaveBeenCalledWith(expect.anything(), {
    requestId: "request-a", branchId: "branch-a", receivedBy: "user-a", rows: [{ id: "line-a", qty_diterima: 2, kondisi: "baik", notes: "" }],
  });
});

it("keeps the draft unacknowledged when the atomic receipt fails", async () => {
  state.receipt.mockResolvedValue({ ok: false, error: "stok kurang" });
  await expect(terimaBarang(form({ request_id: "request-a" }))).rejects.toThrow(/error=stok/);
});

it.each<Record<string, string>>([{ request_key: "" }, { items: "[]" }, { to_warehouse_id: "" }])("rejects incomplete input before posting: %j", async values => {
  await expect(buatPermintaanKasir(form(values))).rejects.toThrow(/baru\?error=/);
  expect(state.rpc).not.toHaveBeenCalled(); expect(state.writes).toEqual([]);
});

it.each(["auth", "shift"] as const)("preserves the %s gate before any posting", async gate => {
  state[gate] = false;
  await expect(buatPermintaanKasir(form())).rejects.toThrow(gate === "auth" ? "/login" : "/kasir/mulai");
  expect(state.rpc).not.toHaveBeenCalled(); expect(state.writes).toEqual([]);
});
