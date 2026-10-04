import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), guard: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/lib/master-guard", () => ({ assertRole: state.guard }));
// Vitest resolves these aliases explicitly because this repository has no Vite alias config.
vi.mock("../master-guard", () => ({ assertRole: state.guard }));
import { buatPengiriman, buatFakturJual } from "../../app/(app)/penjualan/pesanan/actions";
const form = () => {
  const f = new FormData();
  f.set("id", "00000000-0000-4000-8000-000000000001");
  f.set("request_key", "form-stable-key");
  f.set("tanggal", "2026-10-04");
  f.set("qty_00000000-0000-4000-8000-000000000002", "2");
  return f;
};
beforeEach(() => {
  vi.clearAllMocks();
  state.guard.mockResolvedValue({ rpc: state.rpc, from: state.from });
  state.rpc.mockResolvedValue({ data: { document_id: "doc", document_no: "DO.TEST.1" }, error: null });
  state.from.mockImplementation(() => { throw new Error("Non-atomic table write/read reached"); });
});
it("ships through one atomic RPC with the stable key and exact user quantities", async () => {
  await expect(buatPengiriman(form())).rejects.toThrow(/success=/);
  expect(state.rpc).toHaveBeenCalledWith("sales_create_delivery", expect.objectContaining({
    p_order_id: "00000000-0000-4000-8000-000000000001", p_request_key: "form-stable-key",
    p_items: [{ order_item_id: "00000000-0000-4000-8000-000000000002", qty: 2 }],
  }));
  expect(state.from).not.toHaveBeenCalled();
});
it("bills through the atomic RPC without deriving stale quantities or prices", async () => {
  await expect(buatFakturJual(form())).rejects.toThrow(/success=/);
  expect(state.rpc).toHaveBeenCalledWith("sales_create_invoice", expect.objectContaining({p_request_key: "form-stable-key"}));
  expect(state.from).not.toHaveBeenCalled();
});
it("reports posting failure and never redirects to success", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "Stok tidak cukup" } });
  await expect(buatPengiriman(form())).rejects.toThrow(/error=Stok/);
});
it("rejects malformed quantities and missing retry identity before invoking SQL", async () => {
  const f = form(); f.set("qty_00000000-0000-4000-8000-000000000002", "NaN");
  await expect(buatPengiriman(f)).rejects.toThrow(/error=/);
  expect(state.rpc).not.toHaveBeenCalled();
  const missing = form(); missing.delete("request_key");
  await expect(buatFakturJual(missing)).rejects.toThrow(/error=/);
  expect(state.rpc).not.toHaveBeenCalled();
});
