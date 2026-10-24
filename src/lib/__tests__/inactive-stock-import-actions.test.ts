import ExcelJS from "exceljs";
import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  rpc: vi.fn(),
  items: [
    { id: "active", code: "FIX-A", unit: "PCS", item_type: "Persediaan", is_active: true, track_expiry: false, item_units: [] },
    { id: "inactive", code: "FIX-I", unit: "PCS", item_type: "Persediaan", is_active: false, track_expiry: false, item_units: [] },
    { id: "service", code: "FIX-S", unit: "PCS", item_type: "Jasa", is_active: true, track_expiry: false, item_units: [] },
  ],
}));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("Unexpected fixture redirect"); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "fixture-owner" } } }) },
  from(table: string) {
    let first = 0, last = 999;
    const data = () => table === "profiles" ? [{ role: "OWNER", is_active: true }]
      : table === "items" ? fixture.items.slice(first, last + 1)
      : table === "branches" ? [{ id: "fixture-branch", code: "FB", name: "Fiction Branch" }]
      : table === "warehouses" ? [{ id: "fixture-wh", branch_id: "fixture-branch", code: "FW", name: "Fiction Warehouse" }] : [];
    const query = {
      select: () => query, eq: () => query,
      range: (from: number, to: number) => { first = from; last = to; return query; },
      maybeSingle: async () => ({ data: data()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: data(), error: null }).then(resolve),
    };
    return query;
  },
  rpc: fixture.rpc,
}) }));

import { preflightSaldoAwalSekali, previewSaldoAwalAccurate } from "@/app/(app)/pos/sku/impor/actions";

async function form(disableInFile = false) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Barang & Jasa");
  sheet.addRow(["Kategori Barang", "Kode Barang", "Nama Barang", "Jenis Barang", "Satuan", "Non Aktif", "Cabang Saldo", "Gudang Saldo Awal", "Kuantitas Saldo Awal", "Satuan Saldo Awal", "Nilai Satuan", "Per Tanggal"]);
  for (const [code, type, disabled] of [["FIX-A", "INV", false], ["FIX-I", "INV", disableInFile], ["FIX-S", "SVC", false]]) {
    sheet.addRow(["Fiction", code, "Fiction " + code, type, "PCS", disabled ? "Ya" : "Tidak", "FB", "FW", 1, "PCS", 10, null]);
  }
  const result = new FormData();
  result.set("initial_stock_file", new File([Buffer.from(await book.xlsx.writeBuffer())], "fiction-inactive.xlsx"));
  result.set("initial_stock_as_of", "2026-01-01");
  result.set("import_mode", "stock_only");
  return result;
}

beforeEach(() => {
  fixture.items[1].is_active = false;
  fixture.rpc.mockReset().mockResolvedValue({ data: null, error: { message: "Fixture stops before persistence" } });
});

it("holds an inactive inventory SKU as rejected instead of classifying it as a service to skip", async () => {
  await previewSaldoAwalAccurate(await form());
  const rows = fixture.rpc.mock.calls[0][1].p_rows;
  expect(rows.map((r: { status: string }) => r.status)).toEqual(["valid", "rejected", "skipped"]);
  expect(rows[1].reason).toMatch(/tidak aktif/i);
  expect(rows[2].reason).toBe("Jasa atau non-persediaan dilewati");
});

it("projects an explicitly inactive source master as a clarification before stock preparation", async () => {
  fixture.items[1].is_active = true;
  const result = await preflightSaldoAwalSekali(await form(true));
  expect(result.rows.find(row => row.itemCode === "FIX-I")).toMatchObject({ status: "rejected", reason: expect.stringMatching(/tidak aktif/i) });
  expect(result.rows.find(row => row.itemCode === "FIX-A")?.status).toBe("valid");
  expect(fixture.rpc).not.toHaveBeenCalled();
});
