import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc, from: state.from }) }));
import { buatFakturLangsung } from "@/app/(app)/pembelian/faktur/langsung/actions";
import { buatFaktur } from "@/app/(app)/pembelian/faktur/actions";
import { batalkanFakturPembelian } from "@/app/(app)/pembelian/faktur/[id]/actions";
const form = (overrides: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ draft_key: "durable-key", draft_scope: "invoice-direct", supplier_id: "supplier", warehouse_id: "warehouse", tanggal: "2026-10-21", jatuh_tempo: "2026-11-21", items: '[{"item_id":"item","qty":2,"harga":111,"satuan":"box","exp_date":"2027-01-01"}]', lampiran: '[{"path":"pembelian/receipt.pdf","nama":"Receipt","mime":"application/pdf","ukuran":100}]', ...overrides })) data.set(key, value);
  return data;
};
beforeEach(() => { vi.clearAllMocks(); state.from.mockImplementation(() => { throw new Error("Nonatomic write attempted"); }); });
it("posts direct invoice, items and attachments in one request with a durable identity", async () => {
  state.rpc.mockResolvedValue({ data: { invoice_id: "saved", no_jurnal: "JRN-1" }, error: null });
  await expect(buatFakturLangsung(form())).rejects.toThrow("REDIRECT:/pembelian/faktur/saved?success=");
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("create_direct_purchase_invoice", expect.objectContaining({ p_request_key: "durable-key", p_payload: expect.objectContaining({ supplier_id: "supplier", warehouse_id: "warehouse", items: [{ item_id: "item", qty: 2, harga: 111, satuan: "box", exp_date: "2027-01-01" }], lampiran: [{ path: "pembelian/receipt.pdf", nama: "Receipt", mime: "application/pdf", ukuran: 100 }] }) }));
  expect(state.from).not.toHaveBeenCalled();
  expect(state.revalidate).toHaveBeenCalledWith("/");
  expect(state.revalidate).toHaveBeenCalledWith("/pembelian/perintah-bayar");
});
it("refreshes the dashboard and payment candidates after recovering a committed PO invoice", async () => {
  state.rpc.mockResolvedValue({ data: { invoice_id: "saved", no_jurnal: "JRN-1" }, error: null });
  await expect(buatFaktur(form({ items: '[{"po_item_id":"line","qty":1,"harga":10}]' }))).rejects.toThrow("REDIRECT:/pembelian/faktur/saved?success=");
  expect(state.revalidate).toHaveBeenCalledWith("/");
  expect(state.revalidate).toHaveBeenCalledWith("/pembelian/perintah-bayar");
});
it("recovers an uncertain direct result without requiring fields or posting again", async () => {
  state.rpc.mockResolvedValue({ data: { invoice_id: "saved", no_jurnal: "JRN-1" }, error: null });
  await expect(buatFakturLangsung(form({ tindakan: "periksa", invoice_kind: "invoice-direct", items: "invalid" }))).rejects.toThrow("REDIRECT:/pembelian/faktur/saved?success=");
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("get_purchase_operation_result", { p_kind: "invoice-direct", p_request_key: "durable-key" });
});
it("retains the replacement source on rejected creation and never acknowledges a partial result", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "Stock changed" } });
  await expect(buatFakturLangsung(form({ replaces_invoice_id: "source" }))).rejects.toThrow("replace_invoice=source&error=");
  expect(state.revalidate).not.toHaveBeenCalled();
  state.rpc.mockResolvedValue({ data: { invoice_id: "partial" }, error: null });
  await expect(buatFakturLangsung(form())).rejects.toThrow("error=");
  expect(state.revalidate).not.toHaveBeenCalled();
});
it("uses the recorded invoice kind to prepare the existing replacement form", async () => {
  state.rpc.mockResolvedValue({ data: { invoice_id: "source", reversal_journal_id: "reversal", po_id: null }, error: null });
  await expect(batalkanFakturPembelian(form({ invoice_id: "source", revision: "0", alasan: "Wrong price", tindakan: "ganti" }))).rejects.toThrow("REDIRECT:/pembelian/faktur/langsung?replace_invoice=source");
  expect(state.rpc).toHaveBeenCalledWith("cancel_purchase_invoice", expect.objectContaining({ p_invoice_id: "source", p_expected_revision: 0, p_reason: "Wrong price", p_request_key: "durable-key" }));
  state.rpc.mockResolvedValue({ data: { invoice_id: "source", reversal_journal_id: "reversal", po_id: "po" }, error: null });
  await expect(batalkanFakturPembelian(form({ invoice_id: "source", revision: "0", alasan: "Wrong price", tindakan: "ganti" }))).rejects.toThrow("REDIRECT:/pembelian/faktur/baru?replace_invoice=source");
  expect(state.revalidate).toHaveBeenCalledWith("/");
  expect(state.revalidate).toHaveBeenCalledWith("/pembelian/perintah-bayar");
});
