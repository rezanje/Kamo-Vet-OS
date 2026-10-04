import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), guard: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/lib/master-guard", () => ({ assertRole: state.guard }));
import { buatPengiriman, buatFakturJual, batalPesanan, recoverSalesSubmission } from "../../app/(app)/penjualan/pesanan/actions";
import { jadikanPesanan } from "../../app/(app)/penjualan/penawaran/actions";
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
it("keeps an exact over-remainder request for SQL to reject instead of silently clamping", async () => {
  const f = form(); f.set("qty_00000000-0000-4000-8000-000000000002", "9.5");
  state.rpc.mockResolvedValue({data:null,error:{message:"Qty melebihi sisa pesanan"}});
  await expect(buatPengiriman(f)).rejects.toThrow(/error=Qty/);
  expect(state.rpc.mock.calls[0][1].p_items[0].qty).toBe(9.5);
});

it("converts quotation atomically and surfaces line insertion failure", async () => {
  state.rpc.mockResolvedValue({data:null,error:{message:"Gagal menulis baris pesanan"}});
  await expect(jadikanPesanan(form())).rejects.toThrow(/error=Gagal/);
  expect(state.rpc).toHaveBeenCalledWith("sales_convert_quotation", {p_quotation_id:"00000000-0000-4000-8000-000000000001"});
  expect(state.from).not.toHaveBeenCalled();
});
it("cancels using the same database serialization boundary as shipments", async () => {
  state.rpc.mockResolvedValue({data:null,error:{message:"Sebagian barang sudah dikirim"}});
  await expect(batalPesanan(form())).rejects.toThrow(/error=Sebagian/);
  expect(state.rpc).toHaveBeenCalledWith("sales_cancel_order", {p_order_id:"00000000-0000-4000-8000-000000000001"});
  expect(state.from).not.toHaveBeenCalled();
});

it("recovers a committed document using only its key and source order without posting again",async()=>{
  const f=form();f.set("request_scope","delivery:00000000-0000-4000-8000-000000000001");
  await expect(recoverSalesSubmission(f)).rejects.toThrow(/request_done=form-stable-key/);
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("sales_get_posting_result",{
    p_order_id:"00000000-0000-4000-8000-000000000001",p_kind:"delivery",p_request_key:"form-stable-key",
  });
  expect(state.from).not.toHaveBeenCalled();
});
it("keeps identity after recovery finds no committed transaction",async()=>{
  state.rpc.mockResolvedValue({data:null,error:null});const f=form();f.set("request_scope","invoice:00000000-0000-4000-8000-000000000001");
  await expect(recoverSalesSubmission(f)).rejects.toThrow(/error=/);
  expect(state.rpc.mock.calls[0][0]).toBe("sales_get_posting_result");
});
