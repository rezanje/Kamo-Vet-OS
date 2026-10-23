import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc, from: () => { throw new Error("Nonatomic close write"); } }) }));
import { closeRemainingPO } from "@/app/(app)/pembelian/actions";
const form = (overrides: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ po_id: "po", draft_key: "close-key", draft_scope: "purchase-order-short-close:po", confirmed: "1", reason: "Supplier remainder unavailable", expected_rows: '[{"id":"line","qty":10,"qty_terima":5,"qty_rusak":0,"satuan":"pcs","faktor":1}]', ...overrides })) data.set(key, value);
  return data;
};
const proof = { po_id: "po", closed_at: "2026-10-23T00:00:00Z", lines: [{ ordered_qty: 10, received_qty: 5, closed_qty: 5 }] };
beforeEach(() => { vi.clearAllMocks(); state.rpc.mockResolvedValue({ data: proof, error: null }); });
it("acknowledges only a complete atomic close receipt and refreshes invoice/DP candidates", async () => {
  await expect(closeRemainingPO(form())).rejects.toThrow("REDIRECT:/pembelian/po?success=");
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("close_purchase_order_remainder", expect.objectContaining({ p_po_id: "po", p_request_key: "close-key", p_confirmed: true, p_expected_rows: [expect.objectContaining({ qty: 10, qty_terima: 5 })] }));
  expect(state.revalidate).toHaveBeenCalledWith("/pembelian/faktur/baru");
  expect(state.revalidate).toHaveBeenCalledWith("/pembelian/uang-muka");
});
it("recovers a lost reply without requiring confirmation or posting again", async () => {
  await expect(closeRemainingPO(form({ tindakan: "periksa", confirmed: "", reason: "", expected_rows: "invalid" }))).rejects.toThrow("draft_done=close-key");
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("get_purchase_order_short_close", { p_po_id: "po", p_request_key: "close-key" });
});
it.each<Record<string, string>>([{ confirmed: "" }, { reason: "" }, { expected_rows: "invalid" }])("requires explicit confirmation, reason and readable source snapshot: %j", async (bad) => {
  await expect(closeRemainingPO(form(bad))).rejects.not.toThrow("REDIRECT:");
  expect(state.rpc).not.toHaveBeenCalled();
});
it("keeps drafts and reports stale/failed/unconfirmed results without success", async () => {
  state.rpc.mockResolvedValueOnce({ data: null, error: { message: "Penerimaan berubah" } });
  await expect(closeRemainingPO(form())).rejects.toThrow("Penerimaan berubah");
  state.rpc.mockResolvedValueOnce({ data: { po_id: "po" }, error: null });
  await expect(closeRemainingPO(form())).rejects.toThrow("belum terkonfirmasi");
  expect(state.revalidate).not.toHaveBeenCalled();
});
