import ExcelJS from "exceljs";

// Penolong Excel bersama untuk semua unggahan master (promo diskon, dan nanti
// bundling). Satu tempat yang tahu cara membaca sel, menolak rumus, dan
// membentuk berkas format — supaya dua layar impor tidak pelan-pelan jadi beda
// aturan: yang satu menerima rumus, yang lain tidak.

export type SheetRow = { line: number; values: Record<string, string> };

export type TemplateColumn = {
  header: string;
  width?: number;
  /** "@" memaksa teks (kode berawalan nol), "#,##0.00" untuk rupiah. */
  numFmt?: string;
};

const MAX_BYTES = 1_000_000;

function excelDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Satu sel jadi teks yang dapat divalidasi. Rumus ditolak: hasilnya tidak ikut terkirim. */
export function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) return "";
  if (value instanceof Date) return excelDate(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) throw new Error(`Rumus tidak didukung di baris ${cell.row}, kolom ${cell.col}`);
    if ("richText" in value) return value.richText.map(part => part.text).join("").trim();
    if ("text" in value) return String(value.text).trim();
    if ("error" in value) throw new Error(`Sel bernilai error di baris ${cell.row}, kolom ${cell.col}`);
    throw new Error(`Isi sel tidak didukung di baris ${cell.row}, kolom ${cell.col}`);
  }
  return String(value).trim();
}

/**
 * Baca satu sheet sesuai daftar kolom yang didokumentasikan. Kolom boleh berpindah
 * urutan; kolom yang tidak dikenal diabaikan. Baris kosong dilewati.
 */
export async function readSheetRows(bytes: Uint8Array, opts: {
  sheet: string; headers: readonly string[]; maxRows: number;
  /** Kolom yang boleh tidak ada di berkas lama; dibaca sebagai string kosong. */
  optional?: readonly string[];
}): Promise<SheetRow[]> {
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error("File Excel harus 1 byte sampai 1 MB");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(bytes) as never);
  const sheet = book.getWorksheet(opts.sheet);
  if (!sheet) throw new Error(`Sheet ${opts.sheet} tidak ditemukan. Unduh dan isi format dari aplikasi.`);
  const optional = new Set(opts.optional ?? []);
  const header = sheet.getRow(1);
  const cols = opts.headers.map(name => {
    for (let col = 1; col <= sheet.columnCount; col++) {
      if (cellText(header.getCell(col)).toLowerCase() === name.toLowerCase()) return col;
    }
    if (optional.has(name)) return 0;
    throw new Error(`Kolom ${name} tidak ditemukan di sheet ${opts.sheet}`);
  });
  const rows: SheetRow[] = [];
  sheet.eachRow({ includeEmpty: false }, row => {
    if (row.number === 1) return;
    const cells = cols.map(col => (col === 0 ? "" : cellText(row.getCell(col))));
    if (cells.every(value => !value)) return;
    rows.push({ line: row.number, values: Object.fromEntries(opts.headers.map((name, index) => [name, cells[index]])) });
    if (rows.length > opts.maxRows) throw new Error(`Maksimal ${opts.maxRows} baris per file`);
  });
  if (!rows.length) throw new Error(`Sheet ${opts.sheet} belum berisi satu baris pun`);
  return rows;
}

/** Berkas format: satu sheet isian berkolom tebal plus satu sheet petunjuk. */
export async function makeTemplateWorkbook(opts: {
  sheet: string; columns: TemplateColumn[]; guide: [string, string][];
  /** Contoh isian; ditulis apa adanya di bawah header. */
  sample?: (string | number)[][];
}): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  book.creator = "VetOS";
  const sheet = book.addWorksheet(opts.sheet, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = opts.columns.map(column => ({ header: column.header, width: column.width ?? 20 }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "17365D" } };
  opts.columns.forEach((column, index) => { if (column.numFmt) sheet.getColumn(index + 1).numFmt = column.numFmt; });
  (opts.sample ?? []).forEach(row => sheet.addRow(row));
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: opts.columns.length } };
  const guide = book.addWorksheet("Petunjuk");
  guide.columns = [{ width: 26 }, { width: 100 }];
  guide.getRow(1).font = { bold: true };
  opts.guide.forEach(([label, detail]) => guide.addRow([label, detail]));
  return new Uint8Array(await book.xlsx.writeBuffer());
}
