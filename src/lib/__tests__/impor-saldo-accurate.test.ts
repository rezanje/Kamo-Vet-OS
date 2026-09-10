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
  it("melewati saldo nol sebelum HPP pembulatan negatif divalidasi", async () => {
    const parsed = await bacaWorkbookSaldoAwal(await workbook([
      ["Kode Barang", "Satuan", "Kuantitas Saldo Awal", "Satuan Saldo Awal", "Nilai Satuan"],
      ["SKU-NOL", "PCS", 0, "", -0.000006],
      ["SKU-ISI", "PCS", 3, "PCS", 15_000],
    ]));

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ itemCode: "SKU-ISI", qty: 3, unit: "PCS", unitCost: 15_000 });
  });

  it("memakai Satuan master bila Satuan Saldo Awal kosong pada qty positif", async () => {
    const parsed = await bacaWorkbookSaldoAwal(await workbook([
      ["Kode Barang", "Satuan", "Kuantitas Saldo Awal", "Satuan Saldo Awal", "Nilai Satuan"],
      ["SKU-1", "PCS", 2, "", 15_000],
    ]));

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ itemCode: "SKU-1", qty: 2, unit: "PCS" });
  });

  it("menolak HPP negatif pada saldo positif", async () => {
    const parsed = await bacaWorkbookSaldoAwal(await workbook([
      ["Kode Barang", "Satuan", "Kuantitas Saldo Awal", "Satuan Saldo Awal", "Nilai Satuan"],
      ["SKU-1", "PCS", 2, "", -0.000523],
    ]));

    expect(parsed.errors).toEqual(["Baris 2: HPP harus angka nol atau lebih"]);
  });

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

  it("meringkas rumus tanpa nilai tersimpan agar pengguna tahu file sumbernya belum lengkap", async () => {
    const parsed = await bacaWorkbookSaldoAwal(await workbook([
      ["Kode Barang", "Kuantitas Saldo Awal", "Satuan Saldo Awal", "Nilai Satuan"],
      ["SKU-1", { formula: "VLOOKUP(A2,Data!A:B,2,0)" }, "PCS", { formula: "VLOOKUP(A2,Data!A:C,3,0)" }],
    ]));

    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toContain("kuantitas pada 1 baris (2)");
    expect(parsed.errors[0]).toContain("HPP pada 1 baris (2)");
    expect(parsed.errors[0]).toContain("rumus Excel tanpa hasil angka");
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
    expect(resolveInitialStockSourceScope(rows, branches, warehouses, "2024-12-20")).toEqual({
      ok: true,
      branch: branches[0],
      warehouse: warehouses[0],
      asOf: "2024-12-20",
    });
  });

  it("mencocokkan nama gudang file dengan kode gudang lama yang memakai awalan WH", () => {
    const legacyBranch = [{ id: "branch-vet-pdry", code: "VET_PDRY", name: "Klinik Panduraya" }];
    const legacyWarehouse = [{ id: "warehouse-vet-pdry", branch_id: "branch-vet-pdry", code: "WH_VET_PDRY", name: "WH VET PDRY" }];
    const legacyRows = [{ ...rows[0], branchName: "Klinik Panduraya", warehouseName: "VET PDRY" }];

    expect(resolveInitialStockSourceScope(legacyRows, legacyBranch, legacyWarehouse, "2024-12-20"))
      .toEqual({ ok: true, branch: legacyBranch[0], warehouse: legacyWarehouse[0], asOf: "2024-12-20" });
  });

  it("menolak file yang mencampur gudang", () => {
    expect(resolveInitialStockSourceScope([...rows, { ...rows[0], row: 3, warehouseName: "WH LAIN" }], branches, warehouses))
      .toMatchObject({ ok: false, message: expect.stringContaining("lebih dari satu gudang") });
  });

  it("menjelaskan langkah perbaikan bila tanggal saldo kosong", () => {
    expect(resolveInitialStockSourceScope([{ ...rows[0], asOf: null }], branches, warehouses))
      .toMatchObject({
        ok: false,
        message: expect.stringContaining("Tanggal posisi saldo awal"),
      });
  });

  it("memakai tanggal posisi saldo awal saat Per Tanggal kosong", () => {
    expect(resolveInitialStockSourceScope([{ ...rows[0], asOf: null }], branches, warehouses, "2026-09-09"))
      .toEqual({ ok: true, branch: branches[0], warehouse: warehouses[0], asOf: "2026-09-09" });
  });

  it("menolak tanggal posisi yang berbeda dari tanggal di file", () => {
    expect(resolveInitialStockSourceScope(rows, branches, warehouses, "2026-09-09"))
      .toMatchObject({ ok: false, message: expect.stringContaining("berbeda dengan tanggal di file") });
  });
});

describe("resolveSaldoAwalRows", () => {
  it("melewati jasa dan stok nol", () => {
    const resolved = resolveSaldoAwalRows([{
      row: 2, itemCode: "JASA-1", qty: 1, unit: "PCS", unitCost: 20_000,
      batchNo: null, expDate: null, branchName: null, warehouseName: null, asOf: null,
    }], new Map([["jasa-1", {
      id: "jasa-1", code: "JASA-1", unit: "PCS", itemType: "Jasa", trackExpiry: false, units: [],
    }]]), "warehouse-1");

    expect(resolved[0]).toMatchObject({ status: "skipped", reason: "Jasa atau non-persediaan dilewati" });
  });

  it("menggabungkan saldo ganda saat harga dasar sama", () => {
    const rows = resolveSaldoAwalRows([
      { row: 2, itemCode: "SKU-1", qty: 2, unit: "PCS", unitCost: 15_000, batchNo: null, expDate: null, branchName: null, warehouseName: null, asOf: null },
      { row: 3, itemCode: "SKU-1", qty: 3, unit: "PCS", unitCost: 15_000, batchNo: null, expDate: null, branchName: null, warehouseName: null, asOf: null },
    ], new Map([["sku-1", {
      id: "sku-1", code: "SKU-1", unit: "PCS", itemType: "Persediaan", trackExpiry: false, units: [],
    }]]), "warehouse-1");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "valid", baseQty: 5, value: 75_000, sourceRows: [2, 3] });
  });

  it("menahan saldo ganda dengan harga dasar berbeda", () => {
    const rows = resolveSaldoAwalRows([
      { row: 2, itemCode: "SKU-1", qty: 2, unit: "PCS", unitCost: 15_000, batchNo: null, expDate: null, branchName: null, warehouseName: null, asOf: null },
      { row: 3, itemCode: "SKU-1", qty: 3, unit: "PCS", unitCost: 20_000, batchNo: null, expDate: null, branchName: null, warehouseName: null, asOf: null },
    ], new Map([["sku-1", {
      id: "sku-1", code: "SKU-1", unit: "PCS", itemType: "Persediaan", trackExpiry: false, units: [],
    }]]), "warehouse-1");

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "rejected")).toBe(true);
  });
});
