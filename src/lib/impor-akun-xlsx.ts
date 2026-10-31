// Membaca satu sheet .xlsx menjadi tabel mentah (semua baris, nomor baris asli). Server saja.
// Tidak menebak apa pun: pencarian judul & pemeriksaan dilakukan di impor-akun.ts.
import ExcelJS from "exceljs";
import { MAKS_BARIS_TABEL, type TabelSumber } from "./impor-akun";
import type { PemetaanTerblokirAkun } from "./impor-akun-pemetaan";

export const BATAS_XLSX_AKUN = 2 * 1024 * 1024;

function teksSel(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  // Angka diambil apa adanya, bukan teks berformat (format "#,##0" akan mengubah 110001 jadi 110,001).
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && "formula" in v) {
    const r = (v as { result?: unknown }).result;
    return typeof r === "number" || typeof r === "string" || typeof r === "boolean" ? String(r).trim() : "";
  }
  return cell.text.trim();
}

export async function bacaTabelXlsx(
  bytes: Uint8Array, p: PemetaanTerblokirAkun,
): Promise<{ ok: true; tabel: TabelSumber } | { ok: false; pesan: string }> {
  if (bytes.length > BATAS_XLSX_AKUN) return { ok: false, pesan: "File Excel lebih dari 2 MB." };
  const buku = new ExcelJS.Workbook();
  try {
    await buku.xlsx.load(bytes as unknown as Parameters<typeof buku.xlsx.load>[0]);
  } catch {
    return { ok: false, pesan: "File Excel tidak bisa dibaca. Gunakan format .xlsx." };
  }
  const sheet = buku.getWorksheet(p.sheet);
  if (!sheet) {
    return { ok: false, pesan: `Sheet "${p.sheet}" tidak ada di file (sheet yang ada: ${buku.worksheets.map((w) => w.name).join(", ") || "-"}).` };
  }
  if (sheet.rowCount > MAKS_BARIS_TABEL) return { ok: false, pesan: `Sheet ${p.sheet} lebih dari ${MAKS_BARIS_TABEL} baris.` };
  const lebar = Math.max(sheet.columnCount, 1);
  const baris = Array.from({ length: sheet.rowCount }, (_, i) => {
    const row = sheet.getRow(i + 1);
    const sel = Array.from({ length: lebar }, (_, c) => teksSel(row.getCell(c + 1)));
    return { no: i + 1, sel: sel.some((x) => x) ? sel : [] };
  });
  return { ok: true, tabel: { sheet: p.sheet, baris } };
}
