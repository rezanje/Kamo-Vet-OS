import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { bacaWorkbookAccurate, bacaWorkbookKategoriAccurate } from "../impor-accurate";
import { bacaWorkbookSaldoAwal } from "../impor-saldo-accurate";
import {
  buatTemplateImporBarang,
  buatTemplateKategoriImporBarang,
  TEMPLATE_IMPOR_BARANG_HEADERS,
  TEMPLATE_IMPOR_KATEGORI_HEADERS,
} from "../template-impor-barang";

describe("template impor Barang & Jasa", () => {
  it("menghasilkan tabel kosong dengan header yang dibaca dua alur impor", async () => {
    const bytes = await buatTemplateImporBarang();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Barang & Jasa", "Petunjuk"]);
    const dataSheet = workbook.getWorksheet("Barang & Jasa");
    expect(dataSheet).toBeDefined();
    expect(TEMPLATE_IMPOR_BARANG_HEADERS.map((_, index) => dataSheet!.getRow(1).getCell(index + 1).value))
      .toEqual(TEMPLATE_IMPOR_BARANG_HEADERS);
    expect(TEMPLATE_IMPOR_BARANG_HEADERS).toEqual(expect.arrayContaining([
      "Satuan #2", "Rasio Satuan #2", "Def. Hrg. Jual Satuan #2",
      "Satuan #5", "Rasio Satuan #5", "Def. Hrg. Jual Satuan #5",
    ]));
    await expect(bacaWorkbookAccurate(bytes)).resolves.toMatchObject({ errors: [], rows: [], rejected: [] });
    await expect(bacaWorkbookSaldoAwal(bytes)).resolves.toMatchObject({ errors: [], rows: [] });
  });

  it("menghasilkan format kategori dan subkategori yang dibaca alur kategori", async () => {
    const bytes = await buatTemplateKategoriImporBarang();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Kategori Barang", "Petunjuk"]);
    const dataSheet = workbook.getWorksheet("Kategori Barang");
    expect(TEMPLATE_IMPOR_KATEGORI_HEADERS.map((_, index) => dataSheet!.getRow(1).getCell(index + 1).value))
      .toEqual(TEMPLATE_IMPOR_KATEGORI_HEADERS);
    dataSheet!.getCell("A2").value = "ACCESORIS";
    dataSheet!.getCell("A3").value = "ALAT GROOMING";
    dataSheet!.getCell("B3").value = "ACCESORIS";
    const filledBytes = new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer);
    await expect(bacaWorkbookKategoriAccurate(filledBytes)).resolves.toMatchObject({
      errors: [],
      rows: [
        { name: "ACCESORIS", parent_name: null },
        { name: "ALAT GROOMING", parent_name: "ACCESORIS" },
      ],
    });
  });
});
