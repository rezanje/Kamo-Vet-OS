import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadHppReport } from "../hpp-reports-download";
import { clientFixture } from "./fixtures/hpp-report-client";

describe("financial CSV endpoint", () => {
  it("denies deactivated finance accounts through the direct CSV URL", async () => {
    const { client, records } = clientFixture({ role: "FINANCE", active: false });
    const response = await downloadHppReport(client,"inventory",new Request("https://example.test/laporan/nilai-persediaan/unduh"));
    expect(response.status).toBe(403);
    expect(records.some(row => row.table === "stock_layers")).toBe(false);
  });
  it("exports the full scoped inventory with safe attachment headers", async () => {
    const { client } = clientFixture({ tables: {
      stock: Array.from({ length: 205 },(_,i) => ({ id: `s${i}`, warehouse_id: "w1", item_id: `i${i}`, qty: 2 })),
      stock_layers: Array.from({ length: 205 },(_,i) => ({ id: `l${i}`, warehouse_id: "w1", item_id: `i${i}`, qty_left: 2, unit_cost: 50 })),
      items: Array.from({ length: 205 },(_,i) => ({ id: `i${i}`, code: `SKU${i}`, name: `Obat ${i}`, unit: "ml", is_active: true })),
    } });
    const response = await downloadHppReport(client,"inventory",new Request("https://example.test/laporan/nilai-persediaan/unduh?cabang=b1&halaman=2"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="nilai-persediaan-\d{4}-\d{2}-\d{2}\.csv"$/);
    const csv = await response.text();
    expect(csv).toContain("SKU204"); expect(csv.trimEnd().split("\r\n")).toHaveLength(217);
    expect(csv).toContain("Ringkasan dan filter");
    expect(csv).toContain("Subtotal lapisan ber-HPP");
  });
  it("does not leak database errors or return a CSV after failed complete reads", async () => {
    const response = await downloadHppReport(clientFixture({ errorTable: "stock_layers" }).client,"inventory",new Request("https://example.test/laporan/nilai-persediaan/unduh"));
    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.text()).not.toContain("read failed");
  });
  it("returns 401 with private/no-store and no financial data for missing sessions", async () => {
    const client = { auth: { getUser: async () => ({ data: { user: null }, error: null }) } } as unknown as SupabaseClient;
    const response = await downloadHppReport(client,"compound",new Request("https://example.test/laporan/margin-racikan/unduh"));
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "Sesi tidak ditemukan" });
  });
  it("denies doctors with 403 even when they can open the laporan module", async () => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { role: "DOCTOR" }, error: null }) };
    const client = { auth: { getUser: async () => ({ data: { user: { id: "u" } }, error: null }) }, from: () => query } as unknown as SupabaseClient;
    const response = await downloadHppReport(client,"inventory",new Request("https://example.test/laporan/nilai-persediaan/unduh"));
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("pricedValue");
  });
});
