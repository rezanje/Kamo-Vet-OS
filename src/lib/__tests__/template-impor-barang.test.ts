import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { bacaWorkbookAccurate } from "../impor-accurate";
import { bacaWorkbookSaldoAwal } from "../impor-saldo-accurate";
import { buatTemplateImporBarang, TEMPLATE_IMPOR_BARANG_HEADERS } from "../template-impor-barang";

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
    await expect(bacaWorkbookAccurate(bytes)).resolves.toMatchObject({ errors: [], rows: [], rejected: [] });
    await expect(bacaWorkbookSaldoAwal(bytes)).resolves.toMatchObject({ errors: [], rows: [] });
  });
});
