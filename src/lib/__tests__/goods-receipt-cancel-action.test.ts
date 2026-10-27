import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc, from: state.from }) }));
import { batalkanPenerimaan } from "@/app/(app)/pembelian/penerimaan/[id]/actions";

const form = (overrides: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ receipt_id: "gr-1", draft_key: "durable-key", draft_scope: "goods-receipt-cancel:gr-1", alasan: "  Salah input  ", tanggal: "2026-10-28", ...overrides })) data.set(key, value);
  return data;
};
beforeEach(() => { vi.clearAllMocks(); state.from.mockImplementation(() => { throw new Error("Nonatomic write attempted"); }); });

it("cancels through one RPC with the durable key and trimmed reason", async () => {
  state.rpc.mockResolvedValue({ data: { receipt_id: "gr-1", po_id: "po-1", reversal_journal_id: "j" }, error: null });
  await expect(batalkanPenerimaan(form())).rejects.toThrow("REDIRECT:/pembelian/penerimaan/gr-1?success=");
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("cancel_goods_receipt", { p_receipt_id: "gr-1", p_request_key: "durable-key", p_reason: "Salah input", p_tanggal: "2026-10-28" });
  expect(state.from).not.toHaveBeenCalled();
  expect(state.revalidate).toHaveBeenCalledWith("/pembelian/po-1");
  expect(state.revalidate).toHaveBeenCalledWith("/pembelian/penerimaan");
});

it("shows the database refusal (e.g. use purchase return) without revalidating", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "Gunakan Retur Pembelian" } });
  await expect(batalkanPenerimaan(form())).rejects.toThrow(`REDIRECT:/pembelian/penerimaan/gr-1?error=${encodeURIComponent("Gunakan Retur Pembelian")}`);
  expect(state.revalidate).not.toHaveBeenCalled();
});

it("never acknowledges a result for another receipt", async () => {
  state.rpc.mockResolvedValue({ data: { receipt_id: "other" }, error: null });
  await expect(batalkanPenerimaan(form())).rejects.toThrow("belum terkonfirmasi");
  expect(state.revalidate).not.toHaveBeenCalled();
});
