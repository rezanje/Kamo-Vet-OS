import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { bacaWorkbookSaldoAwal, canProceedWithMasterOnly, duplicateStockKeys, initialStockScopeMappingKeys, reconcileInitialStock, resolveInitialStockSourceScope, resolveSaldoAwalRows, toBaseStock } from "../impor-saldo-accurate";

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

describe("canProceedWithMasterOnly", () => {
  it("membolehkan master diimpor saat stok tertahan setelah pemeriksaan master lolos", () => {
    expect(canProceedWithMasterOnly({ masterReady: true, stockCheckComplete: true, stockReady: false })).toBe(true);
    expect(canProceedWithMasterOnly({ masterReady: true, stockCheckComplete: true, stockReady: true })).toBe(false);
    expect(canProceedWithMasterOnly({ masterReady: true, stockCheckComplete: false, stockReady: false })).toBe(false);
    expect(canProceedWithMasterOnly({ masterReady: false, stockCheckComplete: true, stockReady: false })).toBe(false);
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

  // Data fiktif. Helper hanya menerima agregat angka: tes ini tidak membuktikan
  // rekonsiliasi per SKU/gudang maupun jurnal/GL.
  const cocok = { sourceQty: 59, stockQty: 59, layerQty: 59, moveQty: 59, sourceValue: 590_000, layerValue: 590_000 };

  it("lolos tanpa selisih saat stok, layer, move, dan nilai sama dengan sumber", () => {
    expect(reconcileInitialStock(cocok)).toEqual({ ok: true, differences: { stock: 0, layers: 0, moves: 0, value: 0 } });
  });

  it.each([
    { name: "stok", input: { stockQty: 58 }, differences: { stock: -1, layers: 0, moves: 0, value: 0 } },
    { name: "layer", input: { layerQty: 60 }, differences: { stock: 0, layers: 1, moves: 0, value: 0 } },
    { name: "move", input: { moveQty: 57.5 }, differences: { stock: 0, layers: 0, moves: -1.5, value: 0 } },
    { name: "nilai", input: { layerValue: 589_990 }, differences: { stock: 0, layers: 0, moves: 0, value: -10 } },
  ])("menolak dan melaporkan arah selisih $name saja", ({ input, differences }) => {
    expect(reconcileInitialStock({ ...cocok, ...input })).toEqual({ ok: false, differences });
  });

  it("melaporkan semua selisih sekaligus, tidak berhenti di selisih pertama", () => {
    expect(reconcileInitialStock({ ...cocok, stockQty: 60, layerQty: 58, moveQty: 0, layerValue: 600_000 }))
      .toEqual({ ok: false, differences: { stock: 1, layers: -1, moves: -59, value: 10_000 } });
  });

  it("hanya mentoleransi sisa pembulatan di bawah 0,000001", () => {
    expect(reconcileInitialStock({ ...cocok, sourceQty: 0.3, stockQty: 0.1 + 0.2, layerQty: 0.3, moveQty: 0.3 }).ok).toBe(true);
    expect(reconcileInitialStock({ ...cocok, layerValue: 590_000.0000005 }).ok).toBe(true);
    expect(reconcileInitialStock({ ...cocok, layerValue: 590_000.00001 }).ok).toBe(false);
    expect(reconcileInitialStock({ ...cocok, stockQty: 59.00001 }).ok).toBe(false);
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
  it.each([undefined, null, "", "   "])("menolak HPP sumber yang kosong (%j) untuk saldo positif", async (hpp) => {
    for (const qtyHeader of ["Kuantitas", "Kuantitas Saldo Awal"]) {
      const parsed = await bacaWorkbookSaldoAwal(await workbook([
        ["Kode Barang", qtyHeader, "Satuan", "HPP"],
        ["SKU-TANPA-HPP", 2, "PCS", hpp],
      ]));

      expect(parsed.errors).toEqual(["Baris 2: HPP wajib diisi; isi 0 hanya jika nilai sumber memang nol"]);
      expect(parsed.rows[0].unitCost).not.toBe(0);
    }
  });

  it.each([0, "0", "0,00"])("menerima HPP nol yang dinyatakan sumber (%j)", async (hpp) => {
    const parsed = await bacaWorkbookSaldoAwal(await workbook([
      ["Kode Barang", "Kuantitas Saldo Awal", "Satuan", "HPP"],
      ["SKU-NILAI-NOL", 2, "PCS", hpp],
    ]));

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ qty: 2, unitCost: 0 });
  });

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
      sourceQty: "12",
      sourceUnitCost: "15000",
      batchNo: null,
      expDate: null,
      branchName: null,
      warehouseName: null,
      asOf: null,
    }]);
  });

  it("mempertahankan pecahan angka Excel untuk qty dan HPP", async () => {
    const parsed = await bacaWorkbookSaldoAwal(await workbook([
      ["Kode Barang", "Kuantitas Saldo Awal", "Satuan Saldo Awal", "Nilai Satuan"],
      ["SKU-PECAHAN", 2.5, "PCS", 4_350.88],
    ]));

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ qty: 2.5, unitCost: 4_350.88 });
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

  it("meminta keputusan saat nama gudang file hanya mirip dengan gudang lama", () => {
    const legacyBranch = [{ id: "branch-vet-pdry", code: "VET_PDRY", name: "Klinik Panduraya" }];
    const legacyWarehouse = [{ id: "warehouse-vet-pdry", branch_id: "branch-vet-pdry", code: "WH_VET_PDRY", name: "WH VET PDRY" }];
    const legacyRows = [{ ...rows[0], branchName: "Klinik Panduraya", warehouseName: "VET PDRY" }];

    expect(resolveInitialStockSourceScope(legacyRows, legacyBranch, legacyWarehouse, "2024-12-20"))
      .toMatchObject({
        ok: false,
        clarification: {
          sourceBranch: "Klinik Panduraya",
          sourceWarehouse: "VET PDRY",
          candidates: [{ branch: legacyBranch[0], warehouse: legacyWarehouse[0] }],
        },
      });

    expect(resolveInitialStockSourceScope(legacyRows, legacyBranch, legacyWarehouse, "2024-12-20", {
      branchId: "branch-vet-pdry",
      warehouseId: "warehouse-vet-pdry",
    })).toEqual({ ok: true, branch: legacyBranch[0], warehouse: legacyWarehouse[0], asOf: "2024-12-20" });
  });

  it("membuat kunci pemetaan yang stabil hanya untuk satu tujuan file", () => {
    expect(initialStockScopeMappingKeys([{ ...rows[0], branchName: " Klinik  Panduraya ", warehouseName: " VET   PDRY " }]))
      .toEqual({ branchKey: "klinik panduraya", warehouseKey: "vet pdry" });
    expect(initialStockScopeMappingKeys([...rows, { ...rows[0], row: 3, warehouseName: "WH LAIN" }])).toBeNull();
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

  // Barang fiktif dengan tiga satuan: 1 BOX = 12 TAB, 1 STRIP = 10 TAB.
  const multiUnit = new Map([["fiktif-obat", {
    id: "item-fiktif", code: "FIKTIF-OBAT", unit: "TAB", itemType: "Persediaan", trackExpiry: false,
    units: [{ unit: "BOX", factor: 12 }, { unit: "STRIP", factor: 10 }],
  }]]);
  const draft = (row: number, qty: number, unit: string, unitCost: number, extra: Partial<{ sourceQty: string; sourceUnitCost: string; batchNo: string }> = {}) => ({
    row, itemCode: "FIKTIF-OBAT", qty, unit, unitCost, batchNo: null, expDate: null, branchName: null, warehouseName: null, asOf: null, ...extra,
  });

  it("mengonversi beberapa satuan ke satuan dasar tanpa mengubah nilai sumber tiap baris", () => {
    const rows = resolveSaldoAwalRows([
      draft(2, 2, "BOX", 120_000, { batchNo: "B-BOX" }),
      draft(3, 3, "strip", 100_000, { batchNo: "B-STRIP" }),
      draft(4, 5, "TAB", 10_000, { batchNo: "B-TAB" }),
    ], multiUnit, "warehouse-fiktif");

    expect(rows.map((row) => ({ row: row.row, status: row.status, baseQty: row.baseQty, baseUnitCost: row.baseUnitCost, value: row.value, factor: row.sourceValues?.[0].factor })))
      .toEqual([
        { row: 2, status: "valid", baseQty: 24, baseUnitCost: 10_000, value: 240_000, factor: "12" },
        { row: 3, status: "valid", baseQty: 30, baseUnitCost: 10_000, value: 300_000, factor: "10" },
        { row: 4, status: "valid", baseQty: 5, baseUnitCost: 10_000, value: 50_000, factor: "1" },
      ]);
    for (const row of rows) expect(row.value).toBe(row.qty * row.unitCost);
    expect(rows.reduce((sum, row) => sum + row.value, 0)).toBe(590_000);
  });

  it("menggabungkan satuan berbeda pada kunci stok sama dan menjaga total nilai serta jejak sumber", () => {
    const [merged, ...rest] = resolveSaldoAwalRows([
      draft(2, 2, "BOX", 120_000),
      draft(3, 3, "STRIP", 100_000),
      draft(4, 5, "TAB", 10_000),
    ], multiUnit, "warehouse-fiktif");

    expect(rest).toEqual([]);
    expect(merged).toMatchObject({ status: "valid", baseQty: 59, value: 590_000, baseUnitCost: 10_000, baseQtyExact: "59", valueExact: "590000", sourceRows: [2, 3, 4] });
    expect(merged.sourceValues).toEqual([
      { qty: "2", unit_cost: "120000", factor: "12", unit: "BOX" },
      { qty: "3", unit_cost: "100000", factor: "10", unit: "STRIP" },
      { qty: "5", unit_cost: "10000", factor: "1", unit: "TAB" },
    ]);
    // Agregat hasil konversi cocok dengan agregat sumber fiktif.
    expect(reconcileInitialStock({ sourceQty: 59, stockQty: merged.baseQty, layerQty: merged.baseQty, moveQty: merged.baseQty, sourceValue: 590_000, layerValue: merged.value }).ok).toBe(true);
  });

  it("memakai teks angka sumber agar nilai pecahan tidak bergeser saat dikonversi", () => {
    const [row] = resolveSaldoAwalRows([
      draft(2, 0.1, "BOX", 0.3, { sourceQty: "0.1", sourceUnitCost: "0.3" }),
    ], multiUnit, "warehouse-fiktif");

    expect(row).toMatchObject({ status: "valid", baseQtyExact: "1.2", valueExact: "0.03", value: 0.03, baseUnitCost: 0.025 });
  });

  it("tidak merata-ratakan satuan berbeda yang harga dasarnya tidak sama", () => {
    const rows = resolveSaldoAwalRows([
      draft(2, 1, "BOX", 132_000),
      draft(3, 4, "TAB", 10_000),
    ], multiUnit, "warehouse-fiktif");

    expect(rows.map((row) => [row.row, row.status, row.baseUnitCost, row.value])).toEqual([
      [2, "rejected", 11_000, 132_000],
      [3, "rejected", 10_000, 40_000],
    ]);
    expect(rows.every((row) => row.reason === "Saldo ganda dengan harga dasar berbeda")).toBe(true);
  });

  it("menolak satuan yang tidak terdaftar alih-alih menebak faktor konversi", () => {
    const [row] = resolveSaldoAwalRows([draft(2, 1, "KARTON", 1_000_000)], multiUnit, "warehouse-fiktif");
    expect(row).toMatchObject({ status: "rejected", reason: "Satuan tidak terdaftar di master barang" });
  });
});

it.each([
 {unit:'PCS',units:[{unit:'BOX',factor:12},{unit:'box',factor:24}],source:'BoX'},
 {unit:'PCS',units:[{unit:'pcs',factor:12}],source:'PCS'},
])('rejects ambiguous normalized unit mappings before choosing a quantity (%j)',({unit,units,source})=>{
 const rows=resolveSaldoAwalRows([{row:2,itemCode:'FICT',qty:1,unit:source,unitCost:1,batchNo:null,expDate:null,branchName:null,warehouseName:null,asOf:null}],new Map([['fict',{id:'i',code:'FICT',unit,itemType:'Persediaan',trackExpiry:false,units}]]),'w');
 expect(rows[0].status).toBe('rejected');expect(rows[0].reason).toContain('ambigu');
});
