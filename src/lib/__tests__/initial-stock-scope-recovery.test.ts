import ExcelJS from "exceljs";
import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  mappingError: true,
  recoverError: false,
  prepare: vi.fn(async () => ({ data: "11111111-1111-4111-8111-111111111111", error: null })),
}));

vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("Unexpected redirect"); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "fixture-owner" } } }) },
  rpc: fixture.prepare,
  from(table: string) {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      range: async () => ({ data: table === "items"
        ? [{ id: "fixture-item", code: "FIX-A", unit: "PCS", item_type: "Persediaan", is_active: true, track_expiry: false, item_units: [] }]
        : table === "import_run_rows"
          ? [{ source_row: 2, source_code: "FIX-A", status: "valid", reason: null,
            payload: { item_id: "fixture-item", warehouse_id: "fixture-wh", base_qty: "5", base_unit_cost: "10", unit: "PCS" } }]
          : [], error: null }),
      maybeSingle: async () => table === "import_runs" && fixture.recoverError
        ? { data: null, error: { message: "fixture read timeout" } }
        : ({ data: table === "profiles"
        ? { role: "OWNER", is_active: true }
        : table === "import_runs"
          ? { id: "11111111-1111-4111-8111-111111111111", created_by: "fixture-owner", status: "previewed",
            summary: { source_qty: 5, source_value: 50 }, source_hash: "fiction-hash", branch_id: "fixture-branch",
            warehouse_id: "fixture-wh", as_of_date: "2026-01-01" }
          : table === "initial_stock_scope_mappings" ? null : null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "branches"
        ? [{ id: "fixture-branch", code: "FB", name: "Fiction Branch" }]
        : table === "warehouses"
          ? [{ id: "fixture-wh", branch_id: "fixture-branch", code: "FW", name: "Fiction Warehouse" }]
          : [], error: null }).then(resolve),
      upsert: async () => ({ error: fixture.mappingError ? { message: "fixture mapping store unavailable" } : null }),
    };
    return query;
  },
}) }));

import { previewSaldoAwalAccurate } from "@/app/(app)/pos/sku/impor/actions";

async function form() {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Barang & Jasa");
  sheet.addRow(["Kode Barang", "Cabang Saldo", "Gudang Saldo Awal", "Kuantitas Saldo Awal", "Satuan Saldo Awal", "Nilai Satuan", "Per Tanggal"]);
  sheet.addRow(["FIX-A", "FB", "FW", 5, "PCS", 10, null]);
  const data = new FormData();
  data.set("initial_stock_file", new File([Buffer.from(await book.xlsx.writeBuffer())], "fiction.xlsx"));
  data.set("initial_stock_as_of", "2026-01-01");
  data.set("import_mode", "stock_only");
  data.set("scope_branch_id", "fixture-branch");
  data.set("scope_warehouse_id", "fixture-wh");
  return data;
}

it("returns the persisted batch even when optional scope mapping fails after preparation", async () => {
  fixture.mappingError = true;
  fixture.prepare.mockClear();
  const result = await previewSaldoAwalAccurate(await form());
  expect(fixture.prepare).toHaveBeenCalledOnce();
  expect(result).toMatchObject({ ok: true, phase: "preview", run_id: "11111111-1111-4111-8111-111111111111" });
  expect(result.message).toMatch(/pemetaan.*belum tersimpan/i);
});

it("returns the ordinary review result when scope mapping saves", async () => {
  fixture.mappingError = false;
  const result = await previewSaldoAwalAccurate(await form());
  expect(result).toMatchObject({ ok: true, phase: "preview", run_id: "11111111-1111-4111-8111-111111111111" });
  expect(result.message).not.toMatch(/pemetaan.*belum tersimpan/i);
});

it("keeps the prepared batch ID when its saved rows cannot be read back", async () => {
  fixture.mappingError = false;
  fixture.recoverError = true;
  fixture.prepare.mockClear();
  try {
    const result = await previewSaldoAwalAccurate(await form());
    expect(fixture.prepare).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: false, run_id: "11111111-1111-4111-8111-111111111111" });
    expect(result.message).toMatch(/batch tersimpan/i);
    expect(result.message).toMatch(/belum diposting/i);
  } finally {
    fixture.recoverError = false;
  }
});
