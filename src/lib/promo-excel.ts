import ExcelJS from "exceljs";

export type PromoExcelRow = {
  line: number;
  code: string;
  unit: string;
  discount_type: string;
  discount_value: string;
};

const HEADERS = ["Kode Barang", "Satuan", "Jenis Diskon", "Nilai Diskon"] as const;

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) return "";
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) throw new Error(`Rumus tidak didukung di baris ${cell.row}, kolom ${cell.col}`);
    if ("richText" in value) return value.richText.map(part => part.text).join("").trim();
    if ("text" in value) return String(value.text).trim();
    throw new Error(`Isi sel tidak didukung di baris ${cell.row}, kolom ${cell.col}`);
  }
  return String(value).trim();
}

/** Parse only the documented template; prices and SKU identity are checked again before save. */
export async function readPromoExcel(bytes: Uint8Array): Promise<PromoExcelRow[]> {
  if (bytes.length === 0 || bytes.length > 1_000_000) throw new Error("File Excel promo harus 1 byte sampai 1 MB");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(bytes) as never);
  const sheet = book.getWorksheet("Promo");
  if (!sheet) throw new Error("Sheet Promo tidak ditemukan. Unduh dan isi format dari aplikasi.");
  const cols = HEADERS.map(header => {
    for (let col = 1; col <= sheet.columnCount; col++) {
      if (cellText(sheet.getRow(1).getCell(col)).toLowerCase() === header.toLowerCase()) return col;
    }
    throw new Error(`Kolom ${header} tidak ditemukan di sheet Promo`);
  });
  const rows: PromoExcelRow[] = [];
  sheet.eachRow({ includeEmpty: false }, row => {
    if (row.number === 1) return;
    const cells = cols.map(col => cellText(row.getCell(col)));
    if (cells.every(value => !value)) return;
    rows.push({ line: row.number, code: cells[0], unit: cells[1], discount_type: cells[2], discount_value: cells[3] });
    if (rows.length > 500) throw new Error("Maksimal 500 baris promo per file");
  });
  if (!rows.length) throw new Error("Sheet Promo belum berisi baris barang");
  return rows;
}

export async function makePromoExcelTemplate(): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  book.creator = "VetOS";
  const sheet = book.addWorksheet("Promo", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: HEADERS[0], key: "code", width: 24 },
    { header: HEADERS[1], key: "unit", width: 18 },
    { header: HEADERS[2], key: "kind", width: 20 },
    { header: HEADERS[3], key: "value", width: 20 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "17365D" } };
  sheet.getColumn(1).numFmt = "@";
  sheet.getColumn(4).numFmt = "#,##0.00";
  sheet.autoFilter = "A1:D1";
  const guide = book.addWorksheet("Petunjuk");
  guide.columns = [{ width: 26 }, { width: 90 }];
  [
    ["Satu baris", "Satu SKU + satuan + diskon. Boleh ada SKU sama untuk satuan berbeda; jangan ulang kombinasi SKU+satuan."],
    ["Kode Barang", "Isi kode SKU tepat seperti di master VetOS. Simpan kode yang berawalan nol sebagai teks."],
    ["Satuan", "Isi satuan yang terdaftar untuk SKU tersebut, misalnya PCS atau DUS."],
    ["Jenis Diskon", "Isi Persen atau Nominal."],
    ["Nilai Diskon", "Isi angka positif; Persen maksimal 100. Nominal adalah potongan rupiah per satuan yang dipilih."],
    ["Waktu dan cabang", "Isi nama batch, tanggal mulai/akhir, dan cabang di layar impor. Semua baris berbagi periode dan cabang tersebut."],
    ["Sebelum simpan", "Periksa preview; baris dapat diedit. Seluruh batch disimpan sekaligus atau dibatalkan seluruhnya."],
  ].forEach(([label, detail]) => guide.addRow([label, detail]));
  return new Uint8Array(await book.xlsx.writeBuffer());
}
