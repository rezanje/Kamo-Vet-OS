import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { expect, it } from "vitest";
import { bacaWorkbookAccurate, buatPayloadItemAccurate } from "../impor-accurate";
import { bacaWorkbookSaldoAwal, resolveInitialStockSourceScope, resolveSaldoAwalRows } from "../impor-saldo-accurate";

// Run explicitly: RUN_M04_E2E=1 npm test -- src/lib/__tests__/m04-technical-e2e.test.ts
// The Python runner creates and removes an owned PostgreSQL container. No target
// service, customer workbook, or production credential is used.
it.skipIf(process.env.RUN_M04_E2E !== "1")("imports fictional Accurate master and opening stock through native PostgreSQL posting", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Barang & Jasa");
  sheet.addRow(["Kode Barang", "Nama Barang", "Jenis Barang", "Kategori Barang", "Satuan", "Kuantitas Saldo Awal", "Satuan Saldo Awal", "Nilai Satuan", "Cabang Saldo", "Gudang Saldo Awal", "Per Tanggal"]);
  sheet.addRow(["M04-E2E-A", "Fictional A", "INV", "M04 TEST", "PCS", 1, "PCS", 0.333333, "M04-BR", "M04-WH", "2026-01-01"]);
  sheet.addRow(["M04-E2E-B", "Fictional B", "INV", "M04 TEST", "PCS", 2, "PCS", 1, "M04-BR", "M04-WH", "2026-01-01"]);
  sheet.addRow(["M04-E2E-BAD", "Fictional invalid master", "", "M04 TEST", "PCS", 1, "PCS", 1, "M04-BR", "M04-WH", "2026-01-01"]);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const master = await bacaWorkbookAccurate(bytes);
  const balance = await bacaWorkbookSaldoAwal(bytes);
  expect(master.errors).toEqual([]);
  expect(master.rows.map(row => row.code)).toEqual(["M04-E2E-A", "M04-E2E-B"]);
  expect(master.rejected).toMatchObject([{ row_no: 4, code: "M04-E2E-BAD" }]);
  expect(balance.errors).toEqual([]);

  const id = (label: string) => {
    const hex = createHash("md5").update(label).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const branchId = id("m04-e2e-branch"), warehouseId = id("m04-e2e-warehouse");
  const scope = resolveInitialStockSourceScope(balance.rows,
    [{ id: branchId, code: "M04-BR", name: "Fictional branch" }],
    [{ id: warehouseId, branch_id: branchId, code: "M04-WH", name: "Fictional warehouse" }], "2026-01-01");
  expect(scope).toMatchObject({ ok: true, asOf: "2026-01-01" });
  const masterMap = new Map(master.rows.map(row => [row.code.toLowerCase(), {
    id: id(row.code), code: row.code, unit: row.unit, itemType: row.item_type,
    isActive: row.is_active, trackExpiry: row.track_expiry,
    units: row.units.map(unit => ({ unit: unit.unit, factor: unit.factor })),
  }]));
  const resolved = resolveSaldoAwalRows(balance.rows, masterMap, warehouseId);
  expect(resolved.map(row => [row.row, row.status])).toEqual([[2, "valid"], [3, "valid"], [4, "rejected"]]);
  expect(resolved[2].reason).toContain("tidak ditemukan");
  const rows = resolved.map(row => ({
    source_row: row.row, source_code: row.itemCode, status: row.status, reason: row.reason,
    payload: { item_id: row.itemId || null, item_code: row.itemCode, unit: row.unit,
      warehouse_id: row.warehouseId, base_qty: row.baseQtyExact ?? row.baseQty,
      base_unit_cost: row.baseUnitCost, as_of: "2026-01-01", batch_no: row.batchNo,
      exp_date: row.expDate, source_values: row.sourceValues ?? [] },
  }));
  const items = master.rows.map(row => ({
    id: id(row.code), source_row: row.row_no,
    ...buatPayloadItemAccurate(row, { category_id: id("m04-e2e-category"), brand_id: null, supplier_id: null }),
  }));
  const runner = fileURLToPath(new URL("../../../scripts/test-m04-technical-e2e-postgres.py", import.meta.url));
  const result = spawnSync("python3", [runner], {
    input: JSON.stringify({ items, rejected_master: master.rejected, rows, branch_id: branchId, warehouse_id: warehouseId }),
    encoding: "utf8", timeout: 180_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("M04 technical E2E passed");
}, 190_000);
