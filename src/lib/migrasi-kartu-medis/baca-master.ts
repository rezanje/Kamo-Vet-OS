/**
 * Membaca master kartu medis (.xlsx) menjadi blok bertipe, tanpa menafsirkan isi (itu tugas rencana.ts).
 *
 * Gagal-tertutup untuk seluruh berkas bila: batas sumber terlampaui, sistem tanggal 1904, sheet wajib hilang,
 * tanda tangan header tidak ditemukan / tidak lengkap / ganda, penanda versi tidak dikenal, atau batas tabel ambigu.
 * Tidak ada I/O selain bytes yang diberikan; tidak ada jaringan.
 */
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import {
  BATAS_SUMBER, LABEL_PENANDA_VERSI, SHEET_WAJIB, TANDA_TANGAN, VERSI_DIKENAL, VERSI_LEGACY_MASTER_V0,
  normalLabel, type NamaBlok,
} from "./kontrak";

export type Sel =
  | { jenis: "kosong" }
  | { jenis: "teks"; teks: string }
  | { jenis: "angka"; angka: number }
  | { jenis: "tanggal"; tanggal: Date }
  | { jenis: "boolean"; nilai: boolean }
  | { jenis: "rumus"; hasil: Sel }
  | { jenis: "galat"; teks: string };

export type BarisBlok = { baris: number; sel: Record<string, Sel> };
export type Blok = { nama: NamaBlok; sheet: string; barisHeader: number; baris: BarisBlok[]; catatanDilewati: number };

export type HasilBacaMaster =
  | { ok: true; versi: string; sha256: string; peringatan: string[]; blok: Record<NamaBlok, Blok> }
  | { ok: false; sha256: string | null; galat: string[] };

const KOSONG: Sel = { jenis: "kosong" };

/** Sel kosong untuk keperluan batas tabel: kosong, atau teks yang hanya berisi spasi. */
export function selKosong(sel: Sel): boolean {
  return sel.jenis === "kosong" || (sel.jenis === "teks" && sel.teks.trim() === "");
}

export function selDari(value: ExcelJS.CellValue | undefined): Sel {
  if (value === null || value === undefined) return KOSONG;
  if (typeof value === "string") return value === "" ? KOSONG : { jenis: "teks", teks: value };
  if (typeof value === "number") return { jenis: "angka", angka: value };
  if (typeof value === "boolean") return { jenis: "boolean", nilai: value };
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? { jenis: "galat", teks: "tanggal tidak valid" } : { jenis: "tanggal", tanggal: value };
  if (typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    if ("formula" in v || "sharedFormula" in v) return { jenis: "rumus", hasil: selDari(v.result as ExcelJS.CellValue | undefined) };
    if (Array.isArray(v.richText)) {
      const teks = (v.richText as Array<{ text?: unknown }>).map((part) => String(part?.text ?? "")).join("");
      return teks === "" ? KOSONG : { jenis: "teks", teks };
    }
    if ("hyperlink" in v && "text" in v) {
      const inner = v.text;
      if (typeof inner === "string") return inner === "" ? KOSONG : { jenis: "teks", teks: inner };
      return selDari(inner as ExcelJS.CellValue);
    }
    if ("error" in v) return { jenis: "galat", teks: String(v.error) };
  }
  return { jenis: "galat", teks: "jenis sel tidak dikenal" };
}

/** Teks sel untuk mencocokkan label/penanda (bukan untuk data). */
function teksLabel(sel: Sel): string {
  return sel.jenis === "teks" ? sel.teks : "";
}

/**
 * Batas isi zip dari direktori pusat (tanpa dekompresi). ZIP64 atau struktur tak terbaca = ditolak.
 */
export function periksaZip(bytes: Uint8Array): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minEocd; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return "Berkas bukan .xlsx yang terbaca (zip tidak dikenali).";
  const entri = view.getUint16(eocd + 10, true);
  const ukuranCd = view.getUint32(eocd + 12, true);
  const offsetCd = view.getUint32(eocd + 16, true);
  if (entri === 0xffff || ukuranCd === 0xffffffff || offsetCd === 0xffffffff) return "Berkas zip64 tidak didukung.";
  if (entri > BATAS_SUMBER.entriZip) return `Isi berkas melebihi ${BATAS_SUMBER.entriZip} entri.`;
  if (offsetCd + ukuranCd > eocd) return "Direktori zip tidak konsisten.";
  let pos = offsetCd;
  let total = 0;
  for (let n = 0; n < entri; n += 1) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) return "Direktori zip tidak konsisten.";
    const tak = view.getUint32(pos + 24, true);
    if (tak === 0xffffffff) return "Berkas zip64 tidak didukung.";
    total += tak;
    if (total > BATAS_SUMBER.bytesTakTerkompresi) return `Isi berkas melebihi ${BATAS_SUMBER.bytesTakTerkompresi / 1024 / 1024} MB setelah dekompresi.`;
    pos += 46 + view.getUint16(pos + 28, true) + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
  }
  return null;
}

type Kisi = { baris: number; kolom: number; sel: (r: number, c: number) => Sel };

function kisi(sheet: ExcelJS.Worksheet): Kisi {
  return {
    baris: sheet.rowCount,
    kolom: sheet.columnCount,
    sel: (r, c) => selDari(sheet.getRow(r).getCell(c).value),
  };
}

type Header = { nama: NamaBlok; baris: number; kolom: Record<string, number> };

/** Cari baris header tiap tanda tangan pada sheet ini (pemindaian terbatas). */
function cariHeader(k: Kisi, sheetName: string, galat: string[]): Header[] {
  const blokSheet = (Object.keys(TANDA_TANGAN) as NamaBlok[]).filter((nama) => TANDA_TANGAN[nama].sheet === sheetName);
  const ditemukan: Header[] = [];
  const batas = Math.min(k.baris, BATAS_SUMBER.barisPindaiHeader);
  for (let r = 1; r <= batas; r += 1) {
    const posisi = new Map<string, number[]>();
    for (let c = 1; c <= k.kolom; c += 1) {
      const label = normalLabel(teksLabel(k.sel(r, c)));
      if (label) posisi.set(label, [...(posisi.get(label) ?? []), c]);
    }
    for (const nama of blokSheet) {
      const label = TANDA_TANGAN[nama].label as Record<string, string>;
      const entri = Object.entries(label);
      const ada = entri.filter(([, teks]) => posisi.has(normalLabel(teks)));
      if (!ada.length) continue;
      // Nama blok berbagi label pendek ("File") — hanya hitung blok yang cocok sebagian besar.
      if (ada.length === entri.length && entri.every(([, teks]) => posisi.get(normalLabel(teks))!.length === 1)) {
        ditemukan.push({ nama, baris: r, kolom: Object.fromEntries(entri.map(([field, teks]) => [field, posisi.get(normalLabel(teks))![0]])) });
      } else if (ada.length * 2 >= entri.length) {
        galat.push(`Sheet ${sheetName} baris ${r}: header ${nama} tidak lengkap atau ganda; perubahan format perlu review mapping.`);
      }
    }
  }
  for (const nama of blokSheet) {
    const jumlah = ditemukan.filter((h) => h.nama === nama).length;
    if (jumlah === 0) galat.push(`Sheet ${sheetName}: header ${nama} tidak ditemukan di ${BATAS_SUMBER.barisPindaiHeader} baris pertama.`);
    if (jumlah > 1) galat.push(`Sheet ${sheetName}: header ${nama} muncul ${jumlah} kali.`);
  }
  return ditemukan;
}

function barisKosong(k: Kisi, r: number, kolom: number[]) {
  return kolom.every((c) => selKosong(k.sel(r, c)));
}

/**
 * Data blok: tepat di bawah header sampai baris pertama yang semua kolom bloknya kosong, atau header blok lain.
 * Setelah batas itu: baris dengan ≥2 kolom blok terisi sebelum header berikutnya, atau isi apa pun bila tidak ada
 * header berikutnya = batas tabel ambigu (gagal). Satu sel terisi sebelum header berikutnya = catatan, dilewati.
 */
function bacaBlok(k: Kisi, sheetName: string, header: Header, semuaHeader: Header[], galat: string[]): BarisBlok[] {
  const kolom = Object.values(header.kolom);
  const headerBerikut = semuaHeader.map((h) => h.baris).filter((b) => b > header.baris).sort((a, b) => a - b)[0];
  const akhirSheet = k.baris;
  const baris: BarisBlok[] = [];
  let r = header.baris + 1;
  for (; r <= akhirSheet && r !== headerBerikut; r += 1) {
    if (barisKosong(k, r, kolom)) break;
    if (baris.length >= BATAS_SUMBER.barisDataPerSheet) {
      galat.push(`Sheet ${sheetName}: blok ${header.nama} melebihi ${BATAS_SUMBER.barisDataPerSheet} baris.`);
      return [];
    }
    baris.push({ baris: r, sel: Object.fromEntries(Object.entries(header.kolom).map(([field, c]) => [field, k.sel(r, c)])) });
  }
  const sampai = headerBerikut ? headerBerikut - 1 : akhirSheet;
  for (let s = r; s <= sampai; s += 1) {
    const terisi = kolom.filter((c) => !selKosong(k.sel(s, c))).length;
    if (!terisi) continue;
    if (!headerBerikut || terisi >= 2) {
      galat.push(`Sheet ${sheetName} baris ${s}: ada isi setelah akhir tabel ${header.nama} (baris kosong di tengah data?). Batas tabel ambigu.`);
      return [];
    }
  }
  return baris;
}

function catatanDiAntara(k: Kisi, header: Header, semuaHeader: Header[], jumlahData: number) {
  const kolom = Object.values(header.kolom);
  const headerBerikut = semuaHeader.map((h) => h.baris).filter((b) => b > header.baris).sort((a, b) => a - b)[0];
  if (!headerBerikut) return 0;
  let n = 0;
  for (let s = header.baris + jumlahData + 1; s < headerBerikut; s += 1) if (!barisKosong(k, s, kolom)) n += 1;
  return n;
}

function cariPenandaVersi(k: Kisi, galat: string[]): string | null {
  const ditemukan: string[] = [];
  for (let r = 1; r <= Math.min(k.baris, BATAS_SUMBER.barisPindaiHeader); r += 1) {
    for (let c = 1; c <= k.kolom; c += 1) {
      if (normalLabel(teksLabel(k.sel(r, c))) !== LABEL_PENANDA_VERSI) continue;
      let nilai = "";
      for (let n = c + 1; n <= Math.min(k.kolom, c + 3); n += 1) {
        const sel = k.sel(r, n);
        if (selKosong(sel)) continue;
        nilai = sel.jenis === "teks" ? sel.teks.trim() : `<${sel.jenis}>`;
        break;
      }
      ditemukan.push(nilai);
    }
  }
  if (ditemukan.length > 1) galat.push("Penanda contract_version muncul lebih dari sekali.");
  if (ditemukan.length === 1 && !VERSI_DIKENAL.includes(ditemukan[0])) {
    galat.push(`Versi kontrak "${ditemukan[0] || "(kosong)"}" tidak dikenal.`);
  }
  return ditemukan.length === 1 ? ditemukan[0] : null;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function bacaMaster(bytes: Uint8Array): Promise<HasilBacaMaster> {
  if (bytes.length > BATAS_SUMBER.bytesBerkas) {
    return { ok: false, sha256: null, galat: [`Berkas melebihi ${BATAS_SUMBER.bytesBerkas / 1024 / 1024} MB.`] };
  }
  const sha256 = sha256Hex(bytes);
  const zip = periksaZip(bytes);
  if (zip) return { ok: false, sha256, galat: [zip] };

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as never);
  } catch {
    return { ok: false, sha256, galat: ["Berkas .xlsx tidak terbaca."] };
  }
  const galat: string[] = [];
  const peringatan: string[] = [];
  if ((workbook.properties as { date1904?: boolean } | undefined)?.date1904) {
    return { ok: false, sha256, galat: ["Sistem tanggal 1904 tidak didukung; simpan ulang master dengan sistem tanggal 1900."] };
  }
  const sheets = new Map(workbook.worksheets.map((sheet) => [sheet.name, sheet]));
  for (const nama of SHEET_WAJIB) if (!sheets.has(nama)) galat.push(`Sheet wajib "${nama}" tidak ada.`);
  const lain = workbook.worksheets.map((s) => s.name).filter((nama) => !SHEET_WAJIB.includes(nama));
  if (lain.length) peringatan.push(`${lain.length} sheet lain diabaikan (tidak dibaca sebagai data atau otorisasi).`);
  if (galat.length) return { ok: false, sha256, galat };

  const blok = {} as Record<NamaBlok, Blok>;
  let versi: string | null = null;
  for (const nama of SHEET_WAJIB) {
    const sheet = sheets.get(nama)!;
    const k = kisi(sheet);
    if (k.kolom > BATAS_SUMBER.kolom) { galat.push(`Sheet ${nama}: lebih dari ${BATAS_SUMBER.kolom} kolom.`); continue; }
    if (k.baris > BATAS_SUMBER.barisPindaiHeader + BATAS_SUMBER.barisDataPerSheet * 2) {
      galat.push(`Sheet ${nama}: terlalu banyak baris.`);
      continue;
    }
    if (nama === "Mapping") versi = cariPenandaVersi(k, galat);
    const headers = cariHeader(k, nama, galat);
    if (galat.length) continue;
    for (const header of headers) {
      const baris = bacaBlok(k, nama, header, headers, galat);
      blok[header.nama] = {
        nama: header.nama, sheet: nama, barisHeader: header.baris, baris,
        catatanDilewati: catatanDiAntara(k, header, headers, baris.length),
      };
    }
  }
  if (galat.length) return { ok: false, sha256, galat };
  if (!versi) peringatan.push(`Master tanpa penanda versi; dibaca sebagai ${VERSI_LEGACY_MASTER_V0} karena semua tanda tangan header cocok persis.`);
  return { ok: true, versi: versi ?? VERSI_LEGACY_MASTER_V0, sha256, peringatan, blok };
}
