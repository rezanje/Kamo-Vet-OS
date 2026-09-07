import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

async function kartu(rows: Array<[number, number, unknown]>, name = "KARTU MEDIS PASIEN") {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(name);
  rows.forEach(([row, column, value]) => sheet.getRow(row).getCell(column).value = value as ExcelJS.CellValue);
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function baca(bytes: Uint8Array, fileName = "Rani.xlsx") {
  const loaded = await import("../impor-rekam-medis").catch(() => ({}));
  expect(loaded).toHaveProperty("bacaWorkbookRekamMedis");
  return (loaded as { bacaWorkbookRekamMedis: (b: Uint8Array, f: string) => unknown })
    .bacaWorkbookRekamMedis(bytes, fileName) as Promise<{
      rows: Array<Record<string, unknown>>;
      held: Array<Record<string, unknown>>;
    }>;
}

async function bacaBanyak(files: Array<{ fileName: string; bytes: Uint8Array }>) {
  const loaded = await import("../impor-rekam-medis").catch(() => ({}));
  expect(loaded).toHaveProperty("bacaWorkbooksRekamMedis");
  return (loaded as { bacaWorkbooksRekamMedis: (f: typeof files) => unknown })
    .bacaWorkbooksRekamMedis(files) as Promise<{ rows: Array<Record<string, unknown>>; held: Array<Record<string, unknown>> }>;
}

const lengkap = [
  [2, 1, "No. Rek Med"], [2, 2, "RM-100"], [2, 4, "Tanggal Rek"], [2, 5, "2025-03-04"],
  [3, 1, "Nama Pasien"], [3, 2, "Mochi"], [3, 4, "Nama Pemilik"], [3, 5, "Rani"],
  [4, 1, "No Telepon"], [4, 2, "081234567890"], [4, 4, "Alamat"], [4, 5, "Cimanggu"],
  [5, 1, "Jenis Hewan"], [5, 2, "Kucing"], [5, 4, "Ras"], [5, 5, "Domestic"],
  [7, 1, "Anamnesa"], [7, 2, "Muntah dua hari"], [7, 3, "Gambaran Klinis"], [7, 4, "Dehidrasi ringan"],
  [7, 5, "Diagnosa"], [7, 6, "Gastritis"], [7, 7, "Terapi"], [7, 8, "Infus dan obat"],
] as Array<[number, number, unknown]>;

describe("bacaWorkbookRekamMedis", () => {
  it("membaca satu kartu medis lengkap", async () => {
    const hasil = await baca(await kartu(lengkap));
    expect(hasil.held).toEqual([]);
    expect(hasil.rows[0]).toMatchObject({
      source_key: "Rani.xlsx::KARTU MEDIS PASIEN",
      record_no: "RM-100",
      record_date: "2025-03-04",
      patient_name: "Mochi",
      owner_name: "Rani",
      phone: "081234567890",
      diagnosis: "Gastritis",
      anamnesis: "Muntah dua hari",
      clinical_findings: "Dehidrasi ringan",
      therapy: "Infus dan obat",
    });
  });

  it("menahan kartu tanpa tanggal, pasien, atau pemilik", async () => {
    const rusak = lengkap.filter(([row, column]) => !(
      (row === 2 && column === 5) || (row === 3 && column === 2) || (row === 3 && column === 5)
    ));
    const hasil = await baca(await kartu(rusak));
    expect(hasil.rows).toEqual([]);
    expect(hasil.held[0].reason).toContain("Tanggal");
    expect(hasil.held[0].reason).toContain("nama pasien");
    expect(hasil.held[0].reason).toContain("nama pemilik");
  });

  it("membiarkan diagnosis kosong sebagai peringatan, bukan menahan riwayat", async () => {
    const tanpaDiagnosis = lengkap.filter(([row, column]) => !(row === 7 && column === 6));
    const hasil = await baca(await kartu(tanpaDiagnosis));
    expect(hasil.rows).toHaveLength(1);
    expect(hasil.rows[0].warning).toContain("Diagnosis kosong");
  });

  it("menandai tab kosong sebagai bukan kartu yang bisa diimpor", async () => {
    const hasil = await baca(await kartu([], "KARTU MEDIS PASIEN"));
    expect(hasil.rows).toEqual([]);
    expect(hasil.held[0].reason).toContain("kosong");
  });

  it("menahan kemungkinan riwayat ganda walau nomor rekamnya beda", async () => {
    const kedua = lengkap.map(([row, column, value]) => (
      row === 2 && column === 2 ? [row, column, "RM-101"] : [row, column, value]
    )) as Array<[number, number, unknown]>;
    const hasil = await bacaBanyak([
      { fileName: "Rani-1.xlsx", bytes: await kartu(lengkap) },
      { fileName: "Rani-2.xlsx", bytes: await kartu(kedua) },
    ]);
    expect(hasil.rows).toHaveLength(1);
    expect(hasil.held[0].reason).toContain("ganda");
  });
});
