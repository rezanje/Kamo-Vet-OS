import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { bacaWorkbookKomponenGrup, parseKomponenGrupRows } from "../impor-accurate-lanjutan";
import { buatTemplateRincianGrup, TEMPLATE_RINCIAN_GRUP_HEADERS } from "../template-rincian-grup";

async function muat() {
  const bytes = await buatTemplateRincianGrup();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  return { bytes, workbook };
}

describe("template Rincian Grup", () => {
  it("memakai header persis seperti yang diterima pembaca impor", async () => {
    expect(TEMPLATE_RINCIAN_GRUP_HEADERS).toEqual(["Kode Grup", "Kode Komponen", "Kuantitas", "Satuan", "Urutan"]);
    const { workbook } = await muat();
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Rincian Grup", "Petunjuk"]);
    const sheet = workbook.getWorksheet("Rincian Grup")!;
    expect(TEMPLATE_RINCIAN_GRUP_HEADERS.map((_, index) => sheet.getRow(1).getCell(index + 1).value))
      .toEqual(TEMPLATE_RINCIAN_GRUP_HEADERS);
  });

  it("berisi 3 baris contoh fiktif (satu Grup, dua komponen) yang lolos pembaca dan validasi", async () => {
    const { bytes } = await muat();
    const parsed = await bacaWorkbookKomponenGrup(bytes);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.filter((row) => row.groupCode === parsed.rows[0].groupCode)).toHaveLength(2);

    const master = new Map<string, { id: string; itemType: string; unit: string; isActive: boolean }>();
    for (const row of parsed.rows) {
      master.set(row.groupCode.toUpperCase(), { id: `g-${row.groupCode}`, itemType: "Grup", unit: "PAKET", isActive: false });
    }
    for (const row of parsed.rows) {
      master.set(row.componentCode.toUpperCase(), { id: `c-${row.componentCode}`, itemType: "Persediaan", unit: row.unit, isActive: true });
    }
    const hasil = parseKomponenGrupRows(parsed.rows, master);
    expect(hasil.rejected).toEqual([]);
    expect(hasil.valid).toHaveLength(3);
    expect(hasil.incompleteGroups).toEqual([]);
  });

  it("memuat sheet Petunjuk berbahasa Indonesia", async () => {
    const { workbook } = await muat();
    const text: string[] = [];
    workbook.getWorksheet("Petunjuk")!.eachRow((row) => row.eachCell((cell) => text.push(String(cell.value ?? ""))));
    const all = text.join("\n");
    expect(all).toMatch(/Jenis Barang GROUP/);
    expect(all).toMatch(/satu baris per komponen/i);
    expect(all).toMatch(/Rincian Grup/);
  });
});
