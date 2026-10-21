import { expect, it, vi } from "vitest";
import { issueStockDocument } from "../stock-document-issue";
it("derives issued quantity on the server from the original document row", async () => {
  const db = { rpc: vi.fn().mockResolvedValue({ data: { cost: 123 }, error: null }) };
  expect(await issueStockDocument(db, "opname", "result", "item")).toEqual({ cost: 123 });
  expect(db.rpc).toHaveBeenCalledWith("issue_stock_document_recorded", { p_kind: "opname", p_id: "result", p_item_id: "item" });
});
it("does not silently replace failed or missing valuation with zero", async () => {
  const db = { rpc: vi.fn().mockResolvedValue({ data: {}, error: null }) };
  await expect(issueStockDocument(db, "adjustment", "doc", "item")).rejects.toThrow("belum terkonfirmasi");
  db.rpc.mockResolvedValue({ data: null, error: { message: "No access" } });
  await expect(issueStockDocument(db, "adjustment", "doc", "item")).rejects.toThrow("No access");
});
