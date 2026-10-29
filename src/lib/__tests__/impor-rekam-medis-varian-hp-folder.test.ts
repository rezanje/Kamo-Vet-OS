// Parser -> RPC (risiko review independen PR #333): kartu yang sama di folder pemilik yang
// nomornya ditulis "08.." vs "+62 8.." pada dua impor terpisah. Tes ini memastikan fixture
// yang dipakai harness PostgreSQL (kasus S1–S14, C9, C10) adalah keluaran PARSER SUNGGUHAN, bukan
// baris karangan. Harapan perilaku database ada di harness, bukan di sini.
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bacaWorkbooksRekamMedis } from "../impor-rekam-medis";

const KOLOM_RPC = [
  "source_key", "record_no", "record_date", "owner_name", "phone", "address", "patient_name", "species", "breed",
  "gender", "dob", "doctor", "note", "anamnesis", "clinical_findings", "diagnosis", "therapy",
] as const;

async function kartuFiktif() {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("15012026");
  sheet.getCell("A1").value = "KARTU MEDIS PASIEN";
  ([
    [3, 1, "Nama Pasien"], [3, 2, "Kucing Fiktif"], [3, 4, "Nama Pemilik"], [3, 5, "Fiktif Satu"],
    [4, 1, "No Telepon"], [4, 2, "08000000011"],
    [7, 1, "Anamnesa"], [7, 2, "Anamnesis fiktif"], [7, 5, "Diagnosa"], [7, 6, "Diagnosis fiktif"],
  ] as Array<[number, number, string]>).forEach(([row, column, value]) => { sheet.getRow(row).getCell(column).value = value; });
  return new Uint8Array(await book.xlsx.writeBuffer());
}

/** Satu impor = satu pemanggilan parser, seperti dua sesi impor terpisah. */
async function imporFolder(folder: string, bytes: Uint8Array) {
  const hasil = await bacaWorkbooksRekamMedis([{ fileName: "Kucing Fiktif.xlsx", sourcePath: `wowo-test/${folder}/Kucing Fiktif.xlsx`, bytes }]);
  expect(hasil.held).toEqual([]);
  expect(hasil.rows).toHaveLength(1);
  const row = hasil.rows[0];
  return Object.fromEntries(KOLOM_RPC.map((kolom) => [kolom, kolom === "record_date" ? `${row.record_date}T00:00:00+07:00` : row[kolom] ?? null]));
}

describe("kartu sama, folder pemilik 08 vs +62", () => {
  it("fixture harness S1 sama persis dengan keluaran parser", async () => {
    const bytes = await kartuFiktif();
    const hasil = [
      await imporFolder("Fiktif Satu - 08000000011", bytes),
      await imporFolder("Fiktif Satu - +62 800-0000-011", bytes),
    ];
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/impor-folder-hp-varian.json", import.meta.url), "utf8"));
    expect(hasil).toEqual(fixture);
  });
});
