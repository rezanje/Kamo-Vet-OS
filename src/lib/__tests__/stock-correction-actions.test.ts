import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { previewStockCorrection, saveStockCorrection, recoverStockCorrection } from "@/app/(app)/pos/koreksi-stok/actions";
const rows = [{ item_id: "ef400000-0000-4000-8000-000000000001", qty: 3 }];
beforeEach(() => { vi.clearAllMocks(); });
it("previews through the checked RPC without direct writes", async () => {
  db.rpc.mockResolvedValue({ data: { token: "snapshot", lines: [], revision: 0 }, error: null });
  expect(await previewStockCorrection("adjustment", "doc", rows)).toEqual({ data: { token: "snapshot", lines: [], revision: 0 } });
  expect(db.rpc).toHaveBeenCalledWith("preview_stock_document_correction", { p_kind: "adjustment", p_id: "doc", p_rows: rows });
  expect(db.from).not.toHaveBeenCalled();
});
it("submits preview identity and original retry key in one atomic call", async () => {
  db.rpc.mockResolvedValue({ data: { correction_id: "audit", document_id: "doc", revision: 1 }, error: null });
  expect(await saveStockCorrection("opname", "doc", rows, "Wrong count", "key", "snapshot")).toEqual({ data: { correction_id: "audit", document_id: "doc", revision: 1 } });
  expect(db.rpc).toHaveBeenCalledWith("correct_stock_document", { p_kind: "opname", p_id: "doc", p_rows: rows, p_reason: "Wrong count", p_request_key: "key", p_preview_token: "snapshot" });
  expect(db.from).not.toHaveBeenCalled();
});
it("returns rejection without acknowledging a correction", async () => {
  db.rpc.mockResolvedValue({ data: null, error: { message: "Stok sudah terpakai", code: "P0001" } });
  expect(await saveStockCorrection("adjustment", "doc", rows, "Wrong count", "key", "snapshot")).toEqual({ error: "Stok sudah terpakai" });
});
it("does not acknowledge an incomplete RPC result", async () => {
  db.rpc.mockResolvedValue({ data: { document_id: "doc" }, error: null });
  expect(await saveStockCorrection("adjustment", "doc", rows, "Wrong count", "key", "snapshot")).toHaveProperty("error");
});
it("recovers a lost response without another stock write", async () => {
  db.rpc.mockResolvedValue({ data: { correction_id: "audit", document_id: "doc", revision: 1 }, error: null });
  expect(await recoverStockCorrection("adjustment", "doc", "key")).toHaveProperty("data.correction_id", "audit");
  expect(db.rpc).toHaveBeenCalledWith("get_stock_document_correction_result", { p_kind: "adjustment", p_id: "doc", p_request_key: "key" });
});

const held = { item_id: "ef400000-0000-4000-8000-000000000002", name: "Pelontar obat Vet", old_qty: 7, new_qty: 3, reason: "Stok sudah terpakai" };
it("passes the held rows of a mixed preview through, and refuses a malformed held list", async () => {
  db.rpc.mockResolvedValue({ data: { token: "t", revision: 0, lines: [], applied: 2, blocked: [held] }, error: null });
  expect(await previewStockCorrection("opname", "doc", rows)).toEqual({ data: { token: "t", revision: 0, lines: [], applied: 2, blocked: [held] } });
  db.rpc.mockResolvedValue({ data: { token: "t", revision: 0, lines: [], applied: 2, blocked: [{ name: 5 }] }, error: null });
  expect(await previewStockCorrection("opname", "doc", rows)).toHaveProperty("error");
});
it("returns the structured held rows carried in the details of the all-held refusal (preview and save)", async () => {
  const error = { message: "Koreksi tidak bisa disimpan: semua baris yang diubah tertahan. Pelontar obat Vet: Stok sudah terpakai", code: "P0001", details: JSON.stringify([held]) };
  db.rpc.mockResolvedValue({ data: null, error });
  expect(await previewStockCorrection("opname", "doc", rows)).toEqual({ error: error.message, blocked: [held] });
  expect(await saveStockCorrection("opname", "doc", rows, "Alasan", "key", "t")).toEqual({ error: error.message, blocked: [held] });
  db.rpc.mockResolvedValue({ data: null, error: { ...error, details: "bukan json" } });
  expect(await previewStockCorrection("opname", "doc", rows)).toEqual({ error: error.message });
});
it("keeps the held rows and applied count in the saved result", async () => {
  db.rpc.mockResolvedValue({ data: { correction_id: "audit", document_id: "doc", revision: 1, applied: 2, blocked: [held] }, error: null });
  expect(await saveStockCorrection("opname", "doc", rows, "Alasan", "key", "t")).toEqual({ data: { correction_id: "audit", document_id: "doc", revision: 1, applied: 2, blocked: [held] } });
});
