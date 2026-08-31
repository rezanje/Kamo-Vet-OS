import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { bacaWorkbookAccurate } from "../impor-accurate";

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

  it("melewati GROUP dengan alasan eksplisit", async () => {
    const bytes = await workbook([
      ["Kode Barang", "Nama Barang", "Jenis Barang", "Kategori Barang", "Satuan"],
      ["G1", "Paket", "GROUP (barang tipe grup tidak dapat diimport ulang)", "PROMO", "PCS"],
    ]);
    const hasil = await bacaWorkbookAccurate(bytes);
    expect(hasil.rows).toEqual([]);
    expect(hasil.skipped[0].reason).toContain("rincian komponen");
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
