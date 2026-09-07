import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { bacaWorkbookSaldoAwal, duplicateStockKeys, reconcileInitialStock, resolveInitialStockSourceScope, resolveSaldoAwalRows, toBaseStock } from "../impor-saldo-accurate";

async function workbook(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  rows.forEach((row) => ws.addRow(row));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("toBaseStock", () => {
  it("mengubah qty dan HPP ke satuan dasar tanpa mengubah nilai", () => {
    expect(toBaseStock({ qty: 2, factor: 25, unitCost: 450_000 }))
      .toEqual({ baseQty: 50, baseUnitCost: 18_000, value: 900_000 });
  });
});

describe("reconcileInitialStock", () => {
  it("mendeteksi selisih qty, layer, move, dan nilai", () => {
    expect(reconcileInitialStock({
      sourceQty: 10,
      stockQty: 10,
      layerQty: 9,
      moveQty: 10,
      sourceValue: 1000,
      layerValue: 900,
    }).ok).toBe(false);
  });
});

describe("duplicateStockKeys", () => {
  it("menolak baris saldo kembar pada gudang, barang, batch, dan expiry sama", () => {
    const issues = duplicateStockKeys([
      { row: 2, warehouseId: "w", itemId: "i", batchNo: "B1", expDate: "2027-01-01" },
      { row: 3, warehouseId: "w", itemId: "i", batchNo: "B1", expDate: "2027-01-01" },
    ]);
    expect(issues.map((i) => i.row)).toEqual([2, 3]);
  });
});

describe("bacaWorkbookSaldoAwal", () => {
  it("membaca kolom saldo awal dari file Barang dan Jasa Accurate", async () => {
    const parsed = await bacaWorkbookSaldoAwal(await workbook([
      ["Kode Barang", "Kuantitas Saldo Awal", "Satuan Saldo Awal", "Nilai Satuan"],
      ["SKU-1", 12, "PCS", 15_000],
      ["SKU-2", "", "", ""],
    ]));

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([{
      row: 2,
      itemCode: "SKU-1",
      qty: 12,
      unit: "PCS",
      unitCost: 15_000,
      batchNo: null,
      expDate: null,
      branchName: null,
      warehouseName: null,
      asOf: null,
    }]);
  });
});

describe("resolveInitialStockSourceScope", () => {
  const rows = [{
    row: 2, itemCode: "SKU-1", qty: 12, unit: "PCS", unitCost: 15_000,
    batchNo: null, expDate: null, branchName: "PDRY", warehouseName: "WH PDRY", asOf: "2024-12-20",
  }];
  const branches = [{ id: "branch-pdry", code: "PDRY", name: "Kamo Petshop Panduraya" }];
  const warehouses = [{ id: "warehouse-pdry", branch_id: "branch-pdry", code: "WH_PDRY", name: "WH PDRY" }];

  it("memilih cabang, gudang, dan tanggal dari file Accurate", () => {
    expect(resolveInitialStockSourceScope(rows, branches, warehouses)).toEqual({
      ok: true,
      branch: branches[0],
      warehouse: warehouses[0],
      asOf: "2024-12-20",
    });
  });

  it("menolak file yang mencampur gudang", () => {
    expect(resolveInitialStockSourceScope([...rows, { ...rows[0], row: 3, warehouseName: "WH LAIN" }], branches, warehouses))
      .toMatchObject({ ok: false, message: expect.stringContaining("lebih dari satu gudang") });
  });
});

describe("resolveSaldoAwalRows", () => {
  it("menolak jasa meski kode dan satuannya cocok", () => {
    const resolved = resolveSaldoAwalRows([{
      row: 2, itemCode: "JASA-1", qty: 1, unit: "PCS", unitCost: 20_000,
      batchNo: null, expDate: null, branchName: null, warehouseName: null, asOf: null,
    }], new Map([["jasa-1", {
      id: "jasa-1", code: "JASA-1", unit: "PCS", itemType: "Jasa", trackExpiry: false, units: [],
    }]]), "warehouse-1");

    expect(resolved[0]).toMatchObject({ status: "rejected", reason: "Saldo stok hanya untuk barang persediaan" });
  });
});
