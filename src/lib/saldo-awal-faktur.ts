// M05 — saldo awal hutang/piutang per faktur (cutover dari Accurate).
//
// Modul ini hanya MEMBACA file: mengubah sel Excel jadi baris kanonik (tanggal
// YYYY-MM-DD, rupiah bulat sebagai teks digit). Pencocokan pihak, nomor ganda,
// total kontrol, dan semua aturan posting diputuskan ulang oleh database
// (preview_opening_invoices / post_opening_invoices) — klien tidak dipercaya.
import ExcelJS from "exceljs";
import { angka } from "./impor-csv";

export const TEMPLATE_SALDO_AWAL_FAKTUR = "Format-Saldo-Awal-Faktur-VetOS.xlsx";
export const SHEET_SALDO_AWAL_FAKTUR = "Saldo Awal Faktur";
export const KOLOM_SALDO_AWAL_FAKTUR = [
  "Jenis", "Kode Pihak", "Nama Pihak", "No Faktur", "Tanggal Faktur", "Jatuh Tempo", "Sisa Tagihan", "Total Faktur Asli", "Keterangan",
] as const;
export const MAKS_BARIS_SALDO_AWAL_FAKTUR = 2000;
export const MAKS_BYTE_SALDO_AWAL_FAKTUR = 2_000_000;
/** Tanggal cutover yang disepakati: Accurate tutup 31 Okt 2026, VetOS mulai 1 Nov 2026. */
export const TANGGAL_CUTOVER_DEFAULT = "2026-10-31";

export type JenisSaldoAwal = "HUTANG" | "PIUTANG";

/** Baris yang dikirim ke database. Nilai yang gagal dibaca tetap dikirim mentah supaya database menandainya. */
export type BarisSaldoAwalFaktur = {
  baris: number;
  jenis: string;
  kode_pihak: string | null;
  nama_pihak: string;
  no_faktur: string;
  tanggal: string;
  jatuh_tempo: string;
  sisa: string;
  total_asli: string | null;
  keterangan: string | null;
};

export type HasilBacaSaldoAwalFaktur = { rows: BarisSaldoAwalFaktur[]; errors: string[] };

type Kunci = "jenis" | "kode" | "nama" | "no" | "tanggal" | "jatuh_tempo" | "sisa" | "total_asli" | "keterangan";

// Judul kolom dinormalkan (huruf kecil, tanpa spasi/tanda baca) supaya "No. Faktur" = "No Faktur".
const ALIAS: Record<string, Kunci> = {
  jenis: "jenis", tipe: "jenis",
  kodepihak: "kode", kode: "kode", kodepemasok: "kode", kodepelanggan: "kode",
  namapihak: "nama", nama: "nama", namapemasok: "nama", namapelanggan: "nama", pemasok: "nama", pelanggan: "nama",
  nofaktur: "no", nomorfaktur: "no", faktur: "no",
  tanggalfaktur: "tanggal", tglfaktur: "tanggal", tanggal: "tanggal",
  jatuhtempo: "jatuh_tempo", tgljatuhtempo: "jatuh_tempo", tanggaljatuhtempo: "jatuh_tempo",
  sisatagihan: "sisa", sisa: "sisa", sisahutang: "sisa", sisapiutang: "sisa", terutang: "sisa",
  totalfakturasli: "total_asli", totalasli: "total_asli", totalfaktur: "total_asli", nilaifaktur: "total_asli",
  keterangan: "keterangan", catatan: "keterangan",
};
const WAJIB: Kunci[] = ["nama", "no", "tanggal", "jatuh_tempo", "sisa"];
const LABEL: Record<Kunci, string> = {
  jenis: "Jenis", kode: "Kode Pihak", nama: "Nama Pihak", no: "No Faktur", tanggal: "Tanggal Faktur",
  jatuh_tempo: "Jatuh Tempo", sisa: "Sisa Tagihan", total_asli: "Total Faktur Asli", keterangan: "Keterangan",
};

const normalJudul = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const pad = (n: number) => String(n).padStart(2, "0");

function tanggalSah(tahun: number, bulan: number, hari: number): string | null {
  if (tahun < 1900 || tahun > 2999) return null;
  const d = new Date(Date.UTC(tahun, bulan - 1, hari));
  if (d.getUTCFullYear() !== tahun || d.getUTCMonth() + 1 !== bulan || d.getUTCDate() !== hari) return null;
  return `${tahun}-${pad(bulan)}-${pad(hari)}`;
}

/**
 * Sel tanggal → "YYYY-MM-DD". Menerima tanggal Excel asli (Date dari ExcelJS selalu UTC
 * tengah malam — jangan lewat zona lokal), nomor seri Excel, "YYYY-MM-DD", dan
 * "DD/MM/YYYY" / "DD-MM-YYYY" / "DD.MM.YYYY" ala Accurate Indonesia. Selain itu null.
 */
export function tanggalSel(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return tanggalSah(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 1 || value > 400000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return tanggalSah(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const text = String(value ?? "").trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (m) return tanggalSah(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (m) return tanggalSah(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/**
 * Rupiah bulat dari sel Excel. Pemisah ribuan titik atau koma boleh ("1.500.000",
 * "1,500,000", "Rp 1.500.000"); ekor ",00"/".00" dibuang. Sen yang bukan nol, angka
 * negatif, atau teks lain → null (pembayaran faktur hanya menerima rupiah bulat).
 */
export function rupiahBulat(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  let text = String(value ?? "").trim().replace(/^Rp\.?\s*/i, "").replace(/\s/g, "");
  if (!text) return null;
  const sen = /^(.*\d)[.,](\d{1,2})$/.exec(text);
  if (sen) {
    if (/[^0]/.test(sen[2])) return null;
    text = sen[1];
  }
  if (!/^\d{1,3}(?:([.,])\d{3}(?:\1\d{3})*)?$/.test(text) && !/^\d+$/.test(text)) return null;
  const n = angka(text);
  return n !== null && Number.isSafeInteger(n) ? n : null;
}

function teksSel(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value == null) return "";
  if (value instanceof Date || typeof value === "number") return value;
  if (typeof value === "object") {
    if ("result" in value) return value.result instanceof Date || typeof value.result === "number" ? value.result : String(value.result ?? "").trim();
    if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
    if ("text" in value) return String(value.text ?? "").trim();
    if ("error" in value) return "";
    return "";
  }
  return String(value).trim();
}

const teks = (value: unknown) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").trim());

function bacaSheet(sheet: ExcelJS.Worksheet, jenisTetap: JenisSaldoAwal | null, rows: BarisSaldoAwalFaktur[], errors: string[]) {
  const kolom = new Map<Kunci, number>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const kunci = ALIAS[normalJudul(teks(teksSel(cell)))];
    if (kunci && !kolom.has(kunci)) kolom.set(kunci, col);
  });
  const wajib = jenisTetap ? WAJIB : (["jenis", ...WAJIB] as Kunci[]);
  const hilang = wajib.filter((k) => !kolom.has(k));
  if (hilang.length) {
    errors.push(`Sheet ${sheet.name}: kolom wajib tidak ditemukan: ${hilang.map((k) => LABEL[k]).join(", ")}`);
    return;
  }
  for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    const ambil = (k: Kunci) => (kolom.has(k) ? teksSel(row.getCell(kolom.get(k)!)) : "");
    const mentah = (["jenis", "kode", "nama", "no", "tanggal", "jatuh_tempo", "sisa", "total_asli", "keterangan"] as Kunci[]).map(ambil);
    if (mentah.every((v) => teks(v) === "")) continue;
    if (rows.length >= MAKS_BARIS_SALDO_AWAL_FAKTUR) {
      errors.push(`Maksimal ${MAKS_BARIS_SALDO_AWAL_FAKTUR.toLocaleString("id-ID")} baris faktur per file. Pecah file per jenis atau per cabang.`);
      return;
    }
    const sisa = rupiahBulat(ambil("sisa"));
    const asli = teks(ambil("total_asli")) === "" ? null : rupiahBulat(ambil("total_asli"));
    rows.push({
      // Nomor baris dibuat unik lintas sheet: sheet kedua mulai dari 100.000.
      baris: rowNo + (jenisTetap === "PIUTANG" ? 100000 : 0),
      jenis: jenisTetap ?? teks(ambil("jenis")).toUpperCase(),
      kode_pihak: teks(ambil("kode")) || null,
      nama_pihak: teks(ambil("nama")),
      no_faktur: teks(ambil("no")),
      tanggal: tanggalSel(ambil("tanggal")) ?? teks(ambil("tanggal")),
      jatuh_tempo: tanggalSel(ambil("jatuh_tempo")) ?? teks(ambil("jatuh_tempo")),
      sisa: sisa === null ? teks(ambil("sisa")) : String(sisa),
      total_asli: teks(ambil("total_asli")) === "" ? null : asli === null ? teks(ambil("total_asli")) : String(asli),
      keterangan: teks(ambil("keterangan")) || null,
    });
  }
}

/**
 * Baca file isian. Format utama: satu sheet "Saldo Awal Faktur" dengan kolom Jenis.
 * Alternatif: dua sheet "Hutang" dan "Piutang" (kolom Jenis tidak perlu).
 */
export async function bacaWorkbookSaldoAwalFaktur(bytes: Uint8Array): Promise<HasilBacaSaldoAwalFaktur> {
  if (bytes.length === 0 || bytes.length > MAKS_BYTE_SALDO_AWAL_FAKTUR) {
    return { rows: [], errors: ["File Excel harus 1 byte sampai 2 MB."] };
  }
  const book = new ExcelJS.Workbook();
  try { await book.xlsx.load(Buffer.from(bytes) as never); }
  catch { return { rows: [], errors: ["File bukan Excel .xlsx yang dapat dibaca."] }; }
  const cari = (nama: string) => book.worksheets.find((s) => s.name.trim().toLowerCase() === nama.toLowerCase());
  const rows: BarisSaldoAwalFaktur[] = [];
  const errors: string[] = [];
  const utama = cari(SHEET_SALDO_AWAL_FAKTUR);
  const hutang = cari("Hutang");
  const piutang = cari("Piutang");
  if (utama) bacaSheet(utama, null, rows, errors);
  else if (hutang || piutang) {
    if (hutang) bacaSheet(hutang, "HUTANG", rows, errors);
    if (piutang) bacaSheet(piutang, "PIUTANG", rows, errors);
  } else {
    errors.push(`Sheet "${SHEET_SALDO_AWAL_FAKTUR}" (atau sheet "Hutang"/"Piutang") tidak ditemukan. Unduh format dari aplikasi.`);
  }
  if (!errors.length && !rows.length) errors.push("File belum berisi baris faktur.");
  return { rows: errors.length ? [] : rows, errors };
}

/** Jumlah per jenis langsung dari file, untuk dibandingkan dengan total kontrol laporan Accurate. */
export function ringkasFile(rows: BarisSaldoAwalFaktur[]) {
  const hasil = { HUTANG: { jumlah: 0, total: 0 }, PIUTANG: { jumlah: 0, total: 0 } };
  for (const row of rows) {
    const jenis = row.jenis.trim().toUpperCase();
    if (jenis !== "HUTANG" && jenis !== "PIUTANG") continue;
    hasil[jenis].jumlah += 1;
    if (/^\d+$/.test(row.sisa)) hasil[jenis].total += Number(row.sisa);
  }
  return hasil;
}

export async function buatTemplateSaldoAwalFaktur(): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  book.creator = "VetOS";
  const sheet = book.addWorksheet(SHEET_SALDO_AWAL_FAKTUR, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = KOLOM_SALDO_AWAL_FAKTUR.map((header, i) => ({ header, width: [10, 14, 32, 22, 15, 15, 18, 18, 36][i] }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "17365D" } };
  for (const col of [2, 3, 4, 9]) sheet.getColumn(col).numFmt = "@";
  for (const col of [5, 6]) sheet.getColumn(col).numFmt = "dd/mm/yyyy";
  for (const col of [7, 8]) sheet.getColumn(col).numFmt = "#,##0";
  sheet.autoFilter = "A1:I1";
  sheet.addRow(["HUTANG", "S-001", "Contoh Pemasok (hapus baris ini)", "INV/2026/0901", new Date(Date.UTC(2026, 8, 1)), new Date(Date.UTC(2026, 9, 1)), 1500000, 2000000, "Sisa setelah cicilan"]);
  sheet.addRow(["PIUTANG", "C-001", "Contoh Pelanggan (hapus baris ini)", "FJ/2026/0915", new Date(Date.UTC(2026, 8, 15)), new Date(Date.UTC(2026, 9, 15)), 750000, null, null]);
  const guide = book.addWorksheet("Petunjuk");
  guide.columns = [{ width: 24 }, { width: 100 }];
  [
    ["Satu baris", "Satu faktur yang MASIH TERBUKA per tanggal cutover (Accurate tutup 31 Oktober 2026). Faktur lunas tidak perlu diisi."],
    ["Jenis", "HUTANG = tagihan pemasok ke kita. PIUTANG = tagihan kita ke pelanggan."],
    ["Kode Pihak", "Opsional, kode pemasok/pelanggan di Accurate untuk jejak audit. Pencocokan ke master VetOS memakai Nama Pihak."],
    ["Nama Pihak", "Harus sama dengan nama di master pemasok/pelanggan VetOS (huruf besar/kecil dan spasi ganda diabaikan). Pihak yang belum ada ditolak: buat dulu di master."],
    ["No Faktur", "Nomor faktur di Accurate. Hutang: nomor dari pemasok, tidak boleh ganda per pemasok. Piutang: nomor faktur kita, tidak boleh ganda sama sekali."],
    ["Tanggal Faktur", "Tanggal faktur asli (format tanggal Excel atau DD/MM/YYYY). Umur hutang/piutang dihitung dari sini dan dari jatuh tempo."],
    ["Jatuh Tempo", "Tidak boleh sebelum tanggal faktur."],
    ["Sisa Tagihan", "SISA yang belum dibayar per tanggal cutover, bukan total faktur. Rupiah bulat, lebih dari 0. Titik/koma ribuan boleh."],
    ["Total Faktur Asli", "Opsional, untuk referensi. Tidak boleh lebih kecil dari sisa."],
    ["Total kontrol", "Di layar impor, isi total hutang dan total piutang dari laporan umur hutang/piutang Accurate. Posting ditolak kalau jumlah file tidak sama persis."],
    ["Alternatif", "Boleh juga dua sheet bernama Hutang dan Piutang dengan kolom yang sama tanpa kolom Jenis."],
    ["Posting", "Hanya OWNER. Satu jurnal: Modal (3101) ke Hutang Usaha (2101) dan Piutang Usaha (1201) ke Modal. Tidak ada stok, HPP, PPN, atau pendapatan. File yang sama tidak bisa terposting dua kali."],
  ].forEach(([label, detail]) => guide.addRow([label, detail]));
  guide.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  return new Uint8Array(await book.xlsx.writeBuffer());
}
