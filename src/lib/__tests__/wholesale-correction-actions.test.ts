import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
import { koreksiFakturGrosir } from "@/app/(app)/penjualan/faktur/[id]/actions";
import { terimaPembayaranJual } from "@/app/(app)/penjualan/faktur/actions";
const form = () => {
  const fd = new FormData();
  Object.entries({ invoice_id: "invoice", draft_key: "durable", draft_scope: "wholesale:invoice:4", revision: "4", alasan: "Harga salah", tindakan: "replace", tanggal: "2026-10-21", jatuh_tempo: "2026-11-21", line_id: "line", harga_line: "100", jumlah: "30", metode: "Transfer" }).forEach(([k, v]) => fd.set(k, v));
  return fd;
};
beforeEach(() => { vi.clearAllMocks(); db.rpc.mockResolvedValue({ data: { invoice_id: "invoice", correction_id: "audit", reversal_journal_id: "reversal", replacement_id: "new-invoice" }, error: null }); });
it("submits price replacement with durable identity/revision and follows confirmed replacement", async () => {
  await expect(koreksiFakturGrosir(form())).rejects.toThrow("/penjualan/faktur/new-invoice?success=");
  expect(db.rpc).toHaveBeenCalledExactlyOnceWith("correct_wholesale_invoice", {
    p_invoice_id: "invoice", p_expected_revision: 4, p_request_key: "durable", p_action: "replace", p_reason: "Harga salah",
    p_header: { tanggal: "2026-10-21", jatuh_tempo: "2026-11-21", catatan: null, items: [{ id: "line", harga: 100 }] },
  });
  expect(db.from).not.toHaveBeenCalled();
});
it("checks lost response without submitting another correction", async () => {
  const fd = form(); fd.set("tindakan", "periksa"); fd.delete("alasan");
  await expect(koreksiFakturGrosir(fd)).rejects.toThrow("draft_done=durable");
  expect(db.rpc).toHaveBeenCalledExactlyOnceWith("get_wholesale_operation", { p_invoice_id: "invoice", p_kind: "correction", p_request_key: "durable" });
});
it.each([{ data: null, error: { message: "Closed period" } }, { data: { invoice_id: "different", correction_id: "audit", reversal_journal_id: "reversal" }, error: null }, { data: { invoice_id: "invoice", correction_id: "audit" }, error: null }])("does not clear draft on rejected or incomplete correction", async response => {
  db.rpc.mockResolvedValue(response);
  try { await koreksiFakturGrosir(form()); throw new Error("Should redirect"); } catch (error) { expect(String(error)).not.toContain("draft_done"); }
});
it("receives payment through one atomic request and acknowledges the linked journal only", async () => {
  db.rpc.mockResolvedValue({ data: { invoice_id: "invoice", receipt_id: "receipt", journal_id: "journal", document_no: "RC-1" }, error: null });
  const fd = form(); fd.set("tindakan", "simpan");
  await expect(terimaPembayaranJual(fd)).rejects.toThrow("draft_done=durable");
  expect(db.rpc).toHaveBeenCalledExactlyOnceWith("receive_wholesale_payment", { p_request_key: "durable", p_invoice_id: "invoice", p_tanggal: "2026-10-21", p_amount: 30, p_metode: "Transfer", p_account_id: null, p_advance_id: null, p_catatan: null });
  expect(db.from).not.toHaveBeenCalled();
});
it("does not confirm a partial receipt response", async () => {
  db.rpc.mockResolvedValue({ data: { invoice_id: "invoice", receipt_id: "receipt" }, error: null });
  try { await terimaPembayaranJual(form()); } catch (error) { expect(String(error)).not.toContain("draft_done"); }
});
