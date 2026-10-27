import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc, from: state.from, auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) } }) }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ prefix: "PO.FIC.", digit: 5 }) }));
import { buatFakturLangsung } from "@/app/(app)/pembelian/faktur/langsung/actions";
import { buatFaktur } from "@/app/(app)/pembelian/faktur/actions";
import { buatPO } from "@/app/(app)/pembelian/actions";
import { batalkanFakturPembelian } from "@/app/(app)/pembelian/faktur/[id]/actions";
const form = (overrides: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ draft_key: "durable-key", draft_scope: "invoice-direct", supplier_id: "supplier", warehouse_id: "warehouse", tanggal: "2026-10-21", jatuh_tempo: "2026-11-21", items: '[{"item_id":"item","qty":2,"harga":111,"satuan":"box","exp_date":"2027-01-01"}]', lampiran: '[{"path":"pembelian/receipt.pdf","nama":"Receipt","mime":"application/pdf","ukuran":100}]', ...overrides })) data.set(key, value);
  return data;
};
beforeEach(() => { vi.clearAllMocks(); state.from.mockImplementation(() => { throw new Error("Nonatomic write attempted"); }); });
it("posts direct invoice, items and attachments in one request with a durable identity", async () => {
  state.rpc.mockResolvedValue({ data: { invoice_id: "saved", no_jurnal: "JRN-1" }, error: null });
  await expect(buatFakturLangsung(form({ konfirmasi_harga: "1" }))).rejects.toThrow("REDIRECT:/pembelian/faktur/saved?success=");
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

// P04: server-side price check. Reads only the submitted items; never writes outside the RPC.
const readOnly = (tables: Record<string, unknown[]>, inCalls: [string, unknown[]][] = []) => (table: string) => {
  const q: Record<string, unknown> = {};
  const result = () => Promise.resolve({ data: tables[table] ?? [], count: (tables[table] ?? []).length, error: null });
  for (const name of ["select", "eq", "not", "order", "is", "gt"]) q[name] = () => q;
  q.in = (_: string, ids: unknown[]) => { inCalls.push([table, ids]); return q; };
  q.range = result; q.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
  q.then = (resolve: (value: unknown) => unknown) => result().then(resolve);
  return q;
};
const costTables = {
  items: [{ id: "item", name: "Vaksin A", unit: "pcs", sell_price: 0, buy_price: 0 }], item_units: [],
  stock: [{ id: "s1", item_id: "item", qty: 5, average_cost: 10 }],
  profiles: [{ role: "ADMIN", is_active: true }],
  purchase_order_items: [{ id: "line", item_id: "item", faktor: 1 }],
};
it("P04: holds a direct invoice whose price deviates >50% from HPP until confirmed, without saving", async () => {
  const inCalls: [string, unknown[]][] = [];
  state.from.mockImplementation(readOnly(costTables, inCalls));
  const items = '[{"item_id":"item","qty":2,"harga":111,"satuan":"","exp_date":""}]';
  await expect(buatFakturLangsung(form({ items }))).rejects.toThrow(/REDIRECT:\/pembelian\/faktur\/langsung\?harga_cek=.*Vaksin%20A/);
  expect(state.rpc).not.toHaveBeenCalledWith("create_direct_purchase_invoice", expect.anything());
  expect(inCalls.filter(([table]) => table === "stock")).toEqual([["stock", ["item"]]]);
  state.rpc.mockResolvedValue({ data: { invoice_id: "saved", no_jurnal: "JRN-1" }, error: null });
  await expect(buatFakturLangsung(form({ items, konfirmasi_harga: "1" }))).rejects.toThrow("REDIRECT:/pembelian/faktur/saved?success=");
});
it("P04: a bonus line priced 0 never triggers the warning", async () => {
  state.from.mockImplementation(readOnly(costTables));
  state.rpc.mockResolvedValue({ data: { invoice_id: "saved", no_jurnal: "JRN-1" }, error: null });
  await expect(buatFakturLangsung(form({ items: '[{"item_id":"item","qty":2,"harga":0,"satuan":"","exp_date":""}]' }))).rejects.toThrow("REDIRECT:/pembelian/faktur/saved?success=");
});
it("P04: holds a PO invoice whose price per base unit deviates, using the PO line factor", async () => {
  state.from.mockImplementation(readOnly(costTables));
  state.rpc.mockResolvedValue({ data: null, error: null }); // no recovered result
  await expect(buatFaktur(form({ items: '[{"po_item_id":"line","qty":1,"harga":100}]' }))).rejects.toThrow("harga_cek=");
  expect(state.rpc).not.toHaveBeenCalledWith("create_purchase_invoice_from_po", expect.anything());
});
it("P04: holds a PO whose box price per base unit deviates, then saves once confirmed", async () => {
  state.from.mockImplementation(readOnly({ ...costTables, item_units: [{ item_id: "item", unit: "box", factor: 10, sell_price: 0, buy_price: 0 }] }));
  // Box of 10 at 100 = 10 per pcs = HPP: no warning.
  state.rpc.mockResolvedValue({ data: { po_id: "po-1" }, error: null });
  const po = (harga: number, extra: Record<string, string> = {}) => form({ request_key: "po-key", to_warehouse_id: "w", branch_id: "b", items: JSON.stringify([{ nama: "Vaksin A", item_id: "item", qty: 1, harga_beli: harga, satuan: "box" }]), ...extra });
  await expect(buatPO(po(100))).rejects.toThrow("REDIRECT:/pembelian?success=1");
  state.rpc.mockClear();
  // Box price typed as if per pcs (1.000 per box = 100 per pcs): held, nothing saved.
  await expect(buatPO(po(1_000))).rejects.toThrow("REDIRECT:/pembelian/baru?harga_cek=");
  expect(state.rpc).not.toHaveBeenCalledWith("create_purchase_order_atomic", expect.anything());
  await expect(buatPO(po(1_000, { konfirmasi_harga: "1" }))).rejects.toThrow("REDIRECT:/pembelian?success=1");
});
