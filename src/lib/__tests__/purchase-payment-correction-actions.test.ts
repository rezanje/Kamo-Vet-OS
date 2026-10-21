import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mock }));
vi.mock("@/lib/master-guard", () => ({ assertRole: async () => mock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
import { batalkanPembayaranFaktur } from "@/app/(app)/pembelian/faktur/[id]/actions";
import { buatPerintahBayar, setujuiPerintahBayar } from "@/app/(app)/pembelian/perintah-bayar/actions";
const form = () => { const fd = new FormData(); Object.entries({ invoice_id: "invoice", payment_id: "payment", revision: "0", draft_key: "durable-key", draft_scope: "correction", alasan: "Wrong allocation", tindakan: "batal" }).forEach(([key, value]) => fd.set(key, value)); return fd; };
beforeEach(() => { vi.clearAllMocks(); mock.rpc.mockResolvedValue({ data: { payment_id: "payment", invoice_id: "invoice", cancellation_id: "audit", reversal_journal_id: "reversal" }, error: null }); });
it("uses the exact revision, reason and durable identity for payment cancellation", async () => {
  await expect(batalkanPembayaranFaktur(form())).rejects.toThrow("draft_done=durable-key");
  expect(mock.rpc).toHaveBeenCalledWith("cancel_purchase_payment", { p_payment_id: "payment", p_expected_revision: 0, p_request_key: "durable-key", p_reason: "Wrong allocation" });
  expect(mock.from).not.toHaveBeenCalled();
});
it.each([{ data: null, error: { message: "Closed period" } }, { data: { payment_id: "payment", invoice_id: "invoice" }, error: null }])("does not acknowledge rejected or incomplete reversal", async response => {
  mock.rpc.mockResolvedValue(response);
  await expect(batalkanPembayaranFaktur(form())).rejects.toThrow();
  try { await batalkanPembayaranFaktur(form()); } catch (error) { expect(String(error)).not.toContain("draft_done"); }
});
it("prepares an individual replacement only after confirmed cancellation", async () => {
  const fd = form(); fd.set("tindakan", "ganti");
  await expect(batalkanPembayaranFaktur(fd)).rejects.toThrow("/keuangan/hutang?replace_payment=payment");
});
it("routes a grouped replacement back to the restored payment order", async () => {
  mock.rpc.mockResolvedValue({ data: { payment_id: "payment", invoice_id: "invoice", order_id: "order", cancellation_id: "audit", reversal_journal_id: "reversal" }, error: null });
  const fd = form(); fd.set("tindakan", "ganti");
  await expect(batalkanPembayaranFaktur(fd)).rejects.toThrow("/pembelian/perintah-bayar?success=");
});
it("creates order header and selected invoices in a single atomic request", async () => {
  mock.rpc.mockResolvedValue({ data: { order_id: "order", no_pp: "PP-1" }, error: null });
  const fd = form(); fd.set("supplier_id", "supplier"); fd.set("pilih_invoice", "on"); fd.set("jumlah_invoice", "100");
  await expect(buatPerintahBayar(fd)).rejects.toThrow("draft_done=durable-key");
  expect(mock.rpc).toHaveBeenCalledWith("mutate_purchase_payment_order", expect.objectContaining({ p_action: "create", p_request_key: "durable-key", p_items: [{ invoice_id: "invoice", jumlah: 100 }] }));
  expect(mock.from).not.toHaveBeenCalled();
});
it("rejects fractional order amounts and sends optimistic revision on approval", async () => {
  const fd = form(); fd.set("supplier_id", "supplier"); fd.set("pilih_invoice", "on"); fd.set("jumlah_invoice", "0.5");
  await expect(buatPerintahBayar(fd)).rejects.toThrow("rupiah%20bulat"); expect(mock.rpc).not.toHaveBeenCalled();
  mock.rpc.mockResolvedValue({ data: { order_id: "order", no_pp: "PP-1" }, error: null }); fd.set("id", "order"); fd.set("revision", "3");
  await expect(setujuiPerintahBayar(fd)).rejects.toThrow("draft_done");
  expect(mock.rpc).toHaveBeenCalledWith("mutate_purchase_payment_order", expect.objectContaining({ p_action: "approve", p_expected_revision: 3 }));
});

it("checks an uncertain cancellation without writing a fresh transaction", async () => {
  const fd = form(); fd.set("tindakan", "periksa"); fd.delete("alasan");
  await expect(batalkanPembayaranFaktur(fd)).rejects.toThrow("draft_done=durable-key");
  expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("get_purchase_payment_cancellation", { p_payment_id: "payment", p_request_key: "durable-key" });
});
