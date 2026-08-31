import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  bacaWorkbookKategoriAccurate,
  bacaWorkbookAccurate,
  buatPayloadItemAccurate,
  buatPreviewAccurate,
  rencanaIndukKategoriAccurate,
  type AccurateItem,
} from "../impor-accurate";

async function workbook(rows: unknown[][], sheetName = "Barang & Jasa") {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  rows.forEach((row) => ws.addRow(row));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("bacaWorkbookAccurate", () => {
  it("memetakan INV beserta satuan kedua", async () => {
    const bytes = await workbook([
      [
        "Kode Barang", "Nama Barang", "Jenis Barang", "Kategori Barang", "Satuan",
        "Satuan #2", "Rasio Satuan #2", "Def. Hrg. Jual Satuan #1",
        "Def. Hrg. Jual Satuan #2", "Non Aktif",
      ],
      ["ANC0001", "ANC Adult 375gr", "INV", "WET CAN CAT", "PCS", "DUS", "24.000000", "13000", "312000", "TIDAK"],
    ]);

    const hasil = await bacaWorkbookAccurate(bytes);
    expect(hasil.errors).toEqual([]);
    expect(hasil.rows[0]).toMatchObject({
      code: "ANC0001",
      name: "ANC Adult 375gr",
      item_type: "Persediaan",
      category_name: "WET CAN CAT",
      unit: "PCS",
      sell_price: 13_000,
      is_active: true,
      units: [{ unit: "DUS", factor: 24, sell_price: 312_000, buy_price: 0 }],
    });
  });

  it("mengabaikan harga satuan lanjutan yang tidak punya satuan dan rasio", async () => {
    const bytes = await workbook([
      [
        "Kode Barang", "Nama Barang", "Jenis Barang", "Kategori Barang", "Satuan",
        "Satuan #2", "Rasio Satuan #2", "Def. Hrg. Jual Satuan #2",
        "Satuan #3", "Rasio Satuan #3", "Def. Hrg. Jual Satuan #3",
      ],
      ["BOLT", "Bolt Ikan", "INV", "DRY CAT", "PCS", "SAK", 25, 450_000, "", "", 450_000],
    ]);

    const hasil = await bacaWorkbookAccurate(bytes);
    expect(hasil.rejected).toEqual([]);
    expect(hasil.rows[0].units).toEqual([
      { unit: "SAK", factor: 25, sell_price: 450_000, buy_price: 0 },
    ]);
  });

  it.each([["SVC", "Jasa"], ["NON", "Non-Persediaan"]] as const)(
    "memetakan %s menjadi %s",
    async (source, expected) => {
      const bytes = await workbook([
        ["Kode Barang", "Nama Barang", "Jenis Barang", "Kategori Barang", "Satuan"],
        ["X1", "Contoh", source, "UMUM", "PCS"],
      ]);
      expect((await bacaWorkbookAccurate(bytes)).rows[0].item_type).toBe(expected);
    },
  );

  it("memetakan GROUP sebagai Grup nonaktif sampai komponen tersedia", async () => {
    const bytes = await workbook([
      ["Kode Barang", "Nama Barang", "Jenis Barang", "Kategori Barang", "Satuan"],
      ["G1", "Paket", "GROUP (barang tipe grup tidak dapat diimport ulang)", "PROMO", "PCS"],
    ]);
    const hasil = await bacaWorkbookAccurate(bytes);
    expect(hasil.rows[0]).toMatchObject({ item_type: "Grup", is_active: false });
    expect(hasil.skipped).toEqual([]);
  });

  it("menerima header beda kapital/spasi dan menolak header wajib hilang", async () => {
    const alias = await workbook([
      [" kode barang ", "NAMA BARANG", "Jenis Barang", "Kategori Barang", "Satuan"],
      ["X2", "Contoh Alias", "INV", "UMUM", "PCS"],
    ]);
    expect((await bacaWorkbookAccurate(alias)).rows[0].code).toBe("X2");

    const missing = await workbook([
      ["Kode Barang", "Nama Barang"],
      ["X3", "Tanpa tipe"],
    ]);
    expect((await bacaWorkbookAccurate(missing)).errors[0]).toContain("Jenis Barang");
  });

  it("menolak kedua baris berkode duplikat dan angka negatif", async () => {
    const bytes = await workbook([
      ["Kode Barang", "Nama Barang", "Jenis Barang", "Kategori Barang", "Satuan", "Harga Beli"],
      ["DUP", "Satu", "INV", "UMUM", "PCS", 10],
      ["dup", "Dua", "INV", "UMUM", "PCS", 20],
      ["NEG", "Negatif", "INV", "UMUM", "PCS", -1],
    ]);
    const hasil = await bacaWorkbookAccurate(bytes);
    expect(hasil.rows).toEqual([]);
    expect(hasil.rejected.map((row) => row.reason)).toEqual([
      "Kode kembar di dalam file ini",
      "Kode kembar di dalam file ini",
      "Harga beli tidak boleh negatif",
    ]);
  });

  it("menolak bytes yang bukan workbook", async () => {
    await expect(bacaWorkbookAccurate(Buffer.from("bukan xlsx"))).rejects.toThrow();
  });
});

describe("bacaWorkbookKategoriAccurate", () => {
  it("membaca relasi kategori induk dari export Accurate", async () => {
    const bytes = await workbook([
      ["No", "Nama", "Sub Kategori"],
      [1, "POHON", ""],
      [2, "DAUN", "POHON"],
      [3, "RANTING", "POHON"],
    ], "Kategori Barang");

    const hasil = await bacaWorkbookKategoriAccurate(bytes);

    expect(hasil.errors).toEqual([]);
    expect(hasil.rows).toEqual([
      { row_no: 2, name: "POHON", parent_name: null },
      { row_no: 3, name: "DAUN", parent_name: "POHON" },
      { row_no: 4, name: "RANTING", parent_name: "POHON" },
    ]);
  });

  it("menolak induk hilang dan hierarchy melingkar", async () => {
    const indukHilang = await workbook([
      ["Nama", "Sub Kategori"],
      ["DAUN", "POHON"],
    ], "Kategori Barang");
    expect((await bacaWorkbookKategoriAccurate(indukHilang)).errors[0]).toContain("POHON");

    const melingkar = await workbook([
      ["Nama", "Sub Kategori"],
      ["A", "B"],
      ["B", "A"],
    ], "Kategori Barang");
    expect((await bacaWorkbookKategoriAccurate(melingkar)).errors[0]).toContain("melingkar");
  });
});

describe("rencanaIndukKategoriAccurate", () => {
  it("hanya mengubah parent yang berbeda dari Accurate", () => {
    const hasil = rencanaIndukKategoriAccurate([
      { row_no: 2, name: "POHON", parent_name: null },
      { row_no: 3, name: "DAUN", parent_name: "POHON" },
      { row_no: 4, name: "RANTING", parent_name: "POHON" },
    ], [
      { id: "p", name: "POHON", parent_id: null },
      { id: "d", name: "DAUN", parent_id: null },
      { id: "r", name: "RANTING", parent_id: "p" },
    ]);

    expect(hasil).toEqual([{ id: "d", parent_id: "p" }]);
  });
});

const itemAccurate: AccurateItem = {
  row_no: 2,
  code: "SKU-1",
  name: "Makanan Kucing",
  item_type: "Persediaan",
  category_name: "Pakan",
  brand_name: "Kamo",
  unit: "PCS",
  sell_price: 20_000,
  buy_price: 15_000,
  min_stock: 10,
  supplier_name: "Pemasok A",
  buy_unit: "DUS",
  min_buy: 2,
  upc: "8990001",
  track_expiry: true,
  default_discount: 5,
  is_active: true,
  units: [{ unit: "DUS", factor: 24, sell_price: 450_000, buy_price: 350_000 }],
};

describe("buatPreviewAccurate", () => {
  it("membedakan barang baru, sama, update, dilewati, dan ditolak", () => {
    const hasil = buatPreviewAccurate({
      rows: [
        itemAccurate,
        { ...itemAccurate, row_no: 3, code: "SKU-2" },
        { ...itemAccurate, row_no: 4, code: "SKU-3", sell_price: 25_000 },
      ],
      skipped: [{ row_no: 5, code: "GRUP", name: "Paket", reason: "Grup dilewati" }],
      rejected: [{ row_no: 6, code: "BAD", name: "Rusak", reason: "Kode wajib" }],
      errors: [],
    }, [
      { ...itemAccurate, id: "id-2", code: "sku-2", units: [...itemAccurate.units].reverse() },
      { ...itemAccurate, id: "id-3", code: "SKU-3" },
    ]);

    expect(hasil.map((row) => [row.code, row.status])).toEqual([
      ["SKU-1", "Baru"],
      ["SKU-2", "Sama"],
      ["SKU-3", "Update"],
      ["GRUP", "Dilewati"],
      ["BAD", "Ditolak"],
    ]);
    expect(hasil[2].changed_fields).toEqual(["sell_price"]);
  });
});

describe("buatPayloadItemAccurate", () => {
  it("membuat payload master tanpa field stok", () => {
    const payload = buatPayloadItemAccurate(itemAccurate, {
      category_id: "kategori-1",
      brand_id: "merek-1",
      supplier_id: "pemasok-1",
    });

    expect(payload).toMatchObject({
      code: "SKU-1",
      item_type: "Persediaan",
      category_id: "kategori-1",
      brand_id: "merek-1",
      supplier_id: "pemasok-1",
      unit: "PCS",
      buy_unit: "DUS",
      min_stock: 10,
    });
    expect(Object.keys(payload)).not.toEqual(expect.arrayContaining([
      "stock", "qty", "stock_qty", "warehouse_id", "stock_layers",
    ]));
  });

  it("mematikan field stok/pembelian untuk jasa", () => {
    const payload = buatPayloadItemAccurate({
      ...itemAccurate,
      item_type: "Jasa",
      track_expiry: true,
      min_stock: 10,
    }, {
      category_id: "kategori-1",
      brand_id: null,
      supplier_id: "pemasok-1",
    });
    expect(payload).toMatchObject({
      min_stock: 0,
      track_expiry: false,
      supplier_id: null,
      buy_unit: null,
      min_buy: 0,
      tindakan_kategori: "Konsultasi",
    });
  });
});
