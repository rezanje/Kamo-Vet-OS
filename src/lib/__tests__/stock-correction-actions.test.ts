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
