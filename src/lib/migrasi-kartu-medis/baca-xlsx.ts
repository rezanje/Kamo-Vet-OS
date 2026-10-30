/**
 * Pembaca .xlsx minimal dan ketat untuk master kartu medis (pengganti ExcelJS di jalur migrasi).
 *
 * Alasan: master asli ditulis OpenXML SDK — elemen ber-prefix namespace (`<x:c>`), target relasi absolut
 * (`/xl/tables/table1.xml`), dan sel tanggal ISO (`t="d"`). ExcelJS gagal membuka berkas seperti itu, dan sel `t="d"`
 * dibacanya diam-diam sebagai angka. Pembaca ini sadar namespace, menyelesaikan target absolut/relatif, dan membaca
 * semua jenis sel OOXML: `s`, `str`, `inlineStr`, `n`, `b`, `e`, `d`, plus rumus (nilai cache = hasil, bukan data).
 *
 * Tanggal: `t="d"` (ISO 8601) atau angka seri bergaya tanggal (sistem 1900). Sel gabungan tidak disalin ke sel lain
 * (hanya sel kiri-atas yang berisi). Tidak ada evaluasi rumus. Tidak ada jaringan.
 */
import JSZip from "jszip";
import { SaxesParser, type SaxesTagNS } from "saxes";

export type Sel =
  | { jenis: "kosong" }
  | { jenis: "teks"; teks: string }
  | { jenis: "angka"; angka: number }
  | { jenis: "tanggal"; tanggal: Date }
  | { jenis: "boolean"; nilai: boolean }
  | { jenis: "rumus"; hasil: Sel }
  | { jenis: "galat"; teks: string };

export type SheetXlsx = { nama: string; baris: number; kolom: number; sel: (r: number, c: number) => Sel };
export type BukuXlsx = { date1904: boolean; sheets: SheetXlsx[] };

export class XlsxTidakTerbaca extends Error {}

const KOSONG: Sel = { jenis: "kosong" };

const NS_UTAMA = new Set([
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  "http://purl.oclc.org/ooxml/spreadsheetml/main",
]);
const NS_REL_DOK = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
]);
const NS_REL_PAKET = "http://schemas.openxmlformats.org/package/2006/relationships";

type Elemen = { local: string; uri: string; attr: Record<string, string>; attrNs: (uris: Set<string>, local: string) => string | undefined };

/** Jalankan parser SAX ber-namespace atas satu part XML. */
function telusuri(xml: string, buka: (e: Elemen) => void, tutup?: (local: string, uri: string) => void, teks?: (t: string) => void) {
  const parser = new SaxesParser({ xmlns: true });
  let galat: Error | null = null;
  parser.on("error", (e) => { galat ??= e; });
  parser.on("opentag", (tag: SaxesTagNS) => {
    const attr: Record<string, string> = {};
    for (const a of Object.values(tag.attributes)) if (!a.prefix) attr[a.local] = a.value;
    buka({
      local: tag.local, uri: tag.uri, attr,
      attrNs: (uris, local) => Object.values(tag.attributes).find((a) => a.local === local && uris.has(a.uri))?.value,
    });
  });
  if (tutup) parser.on("closetag", (tag: SaxesTagNS) => tutup(tag.local, tag.uri));
  if (teks) {
    parser.on("text", teks);
    parser.on("cdata", teks);
  }
  parser.write(xml.replace(/^﻿/, "")).close();
  if (galat) throw new XlsxTidakTerbaca("XML di dalam berkas rusak.");
}

/** Nama part OPC tanpa garis miring awal; perbandingan tanpa membedakan huruf (OPC case-insensitive). */
function normalPart(nama: string) {
  return nama.replace(/^\/+/, "").toLowerCase();
}

function selesaikanTarget(sumber: string, target: string): string {
  if (target.startsWith("/")) return target.replace(/^\/+/, "");
  const dasar = sumber.includes("/") ? sumber.slice(0, sumber.lastIndexOf("/")).split("/") : [];
  for (const bagian of target.split("/")) {
    if (bagian === "..") dasar.pop();
    else if (bagian !== "." && bagian !== "") dasar.push(bagian);
  }
  return dasar.join("/");
}

function partRels(part: string) {
  const i = part.lastIndexOf("/");
  return i < 0 ? `_rels/${part}.rels` : `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`;
}

type Relasi = { id: string; jenis: string; target: string };

const ID_TANGGAL_BAWAAN = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** Kode format bertanggal/berjam? Bagian pertama saja; teks berkutip, karakter escape, dan warna/kondisi dibuang. */
export function formatTanggal(kode: string): boolean {
  const bagian = kode.split(";")[0]
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[(?![hms]+\])[^\]]*\]/gi, "");
  return /[dmyhs]/i.test(bagian);
}

/** Seri Excel sistem 1900 -> Date UTC (seri 60 = 29 Feb 1900 fiktif Lotus; < 1 tidak dipakai sebagai tanggal). */
export function tanggalDariSeri(seri: number): Date | null {
  if (!Number.isFinite(seri) || seri < 1 || seri === 60 || seri >= 2958466) return null;
  const hari = seri < 60 ? seri - 1 : seri - 2;
  return new Date(Date.UTC(1900, 0, 1) + Math.round(hari * 86_400_000));
}

const ISO_TANGGAL = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** `t="d"`: ISO 8601 ketat. Tanggal tanpa zona dianggap tanggal kalender (UTC tengah malam, sama dengan seri). */
export function tanggalDariIso(teks: string): Date | null {
  const m = teks.trim().match(ISO_TANGGAL);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", s = "00", frac = "", zona] = m;
  const ms = Number((frac + "000").slice(0, 3));
  let waktu = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
  const cek = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (cek.getUTCFullYear() !== Number(y) || cek.getUTCMonth() + 1 !== Number(mo) || cek.getUTCDate() !== Number(d)) return null;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  if (zona && zona !== "Z") {
    const tanda = zona[0] === "-" ? -1 : 1;
    waktu -= tanda * (Number(zona.slice(1, 3)) * 60 + Number(zona.slice(4, 6))) * 60_000;
  }
  return new Date(waktu);
}

function kolomDariRef(ref: string): { r: number; c: number } | null {
  const m = ref.match(/^([A-Z]{1,3})(\d{1,7})$/i);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]), c };
}

export type BatasBaca = { baris: number; kolom: number };

export async function bacaXlsx(bytes: Uint8Array, batas: BatasBaca): Promise<BukuXlsx> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new XlsxTidakTerbaca("Berkas .xlsx tidak terbaca.");
  }
  const parts = new Map<string, JSZip.JSZipObject>();
  zip.forEach((path, file) => { if (!file.dir) parts.set(normalPart(path), file); });
  const baca = async (part: string) => {
    const f = parts.get(normalPart(part));
    return f ? f.async("string") : null;
  };
  const bacaRelasi = async (part: string): Promise<Relasi[]> => {
    const xml = await baca(partRels(part));
    if (xml === null) return [];
    const hasil: Relasi[] = [];
    telusuri(xml, (e) => {
      if (e.local !== "Relationship" || e.uri !== NS_REL_PAKET) return;
      if (e.attr.TargetMode === "External") return;
      if (e.attr.Id && e.attr.Type && e.attr.Target) hasil.push({ id: e.attr.Id, jenis: e.attr.Type, target: selesaikanTarget(part, e.attr.Target) });
    });
    return hasil;
  };
  const jenis = (rel: Relasi, akhiran: string) => rel.jenis.endsWith(`/${akhiran}`);

  const workbookPart = (await bacaRelasi("")).find((r) => jenis(r, "officeDocument"))?.target;
  if (!workbookPart) throw new XlsxTidakTerbaca("Berkas .xlsx tidak terbaca (workbook tidak ditemukan).");
  const workbookXml = await baca(workbookPart);
  if (workbookXml === null) throw new XlsxTidakTerbaca("Berkas .xlsx tidak terbaca (workbook tidak ditemukan).");
  const relWb = await bacaRelasi(workbookPart);

  let date1904 = false;
  const daftarSheet: { nama: string; rid: string }[] = [];
  telusuri(workbookXml, (e) => {
    if (!NS_UTAMA.has(e.uri)) return;
    if (e.local === "workbookPr") date1904 = ["1", "true"].includes((e.attr.date1904 ?? "").toLowerCase());
    if (e.local === "sheet") {
      const rid = e.attrNs(NS_REL_DOK, "id");
      if (!e.attr.name || !rid) throw new XlsxTidakTerbaca("Daftar sheet rusak.");
      daftarSheet.push({ nama: e.attr.name, rid });
    }
  });

  // Shared strings: teks <si> = gabungan <t> langsung atau <r><t>; teks fonetik (<rPh>) diabaikan.
  const sst: string[] = [];
  const sstPart = relWb.find((r) => jenis(r, "sharedStrings"))?.target;
  const sstXml = sstPart ? await baca(sstPart) : null;
  if (sstXml !== null) {
    let saatIni: string[] | null = null;
    let dalamT = false;
    let dalamRph = 0;
    telusuri(sstXml, (e) => {
      if (!NS_UTAMA.has(e.uri)) return;
      if (e.local === "si") saatIni = [];
      else if (e.local === "rPh") dalamRph += 1;
      else if (e.local === "t" && !dalamRph) dalamT = true;
    }, (local, uri) => {
      if (!NS_UTAMA.has(uri)) return;
      if (local === "si") { sst.push((saatIni ?? []).join("")); saatIni = null; }
      else if (local === "rPh") dalamRph -= 1;
      else if (local === "t") dalamT = false;
    }, (t) => { if (dalamT && saatIni) saatIni.push(t); });
  }

  // Gaya: hanya cellXfs (bukan cellStyleXfs) yang dirujuk atribut s sel.
  const formatKustom = new Map<number, string>();
  const xfTanggal: boolean[] = [];
  const gayaPart = relWb.find((r) => jenis(r, "styles"))?.target;
  const gayaXml = gayaPart ? await baca(gayaPart) : null;
  if (gayaXml !== null) {
    let dalamCellXfs = false;
    const xfNumFmt: number[] = [];
    telusuri(gayaXml, (e) => {
      if (!NS_UTAMA.has(e.uri)) return;
      if (e.local === "numFmt" && e.attr.numFmtId && e.attr.formatCode !== undefined) formatKustom.set(Number(e.attr.numFmtId), e.attr.formatCode);
      if (e.local === "cellXfs") dalamCellXfs = true;
      if (e.local === "xf" && dalamCellXfs) xfNumFmt.push(Number(e.attr.numFmtId ?? 0));
    }, (local, uri) => { if (NS_UTAMA.has(uri) && local === "cellXfs") dalamCellXfs = false; });
    for (const id of xfNumFmt) {
      const kode = formatKustom.get(id);
      xfTanggal.push(kode !== undefined ? formatTanggal(kode) : ID_TANGGAL_BAWAAN.has(id));
    }
  }

  const sheets: SheetXlsx[] = [];
  for (const { nama, rid } of daftarSheet) {
    const target = relWb.find((r) => r.id === rid && jenis(r, "worksheet"))?.target;
    const xml = target ? await baca(target) : null;
    if (xml === null) {
      // Chartsheet/dialogsheet bukan data; sheet kerja yang hilang = berkas rusak.
      if (relWb.some((r) => r.id === rid && jenis(r, "worksheet"))) throw new XlsxTidakTerbaca(`Sheet "${nama}" tidak terbaca.`);
      continue;
    }
    sheets.push(bacaSheet(nama, xml, sst, xfTanggal, batas));
  }
  return { date1904, sheets };
}

function bacaSheet(nama: string, xml: string, sst: string[], xfTanggal: boolean[], batas: BatasBaca): SheetXlsx {
  const isi = new Map<number, Map<number, Sel>>();
  let maksBaris = 0;
  let maksKolom = 0;
  let barisSaatIni = 0;
  let kolomSaatIni = 0;
  type SelMentah = { r: number; c: number; t: string; s: number; v: string[] | null; f: boolean; is: string[] | null };
  let sel: SelMentah | null = null;
  let tangkap: string[] | null = null;
  let dalamIs = false;
  let dalamRph = 0;

  const nilai = (m: SelMentah): Sel => {
    const v = m.v?.join("") ?? null;
    switch (m.t) {
      case "s": {
        if (v === null) return KOSONG;
        const i = Number(v);
        if (!Number.isInteger(i) || i < 0 || i >= sst.length) return { jenis: "galat", teks: "shared string tidak ada" };
        return sst[i] === "" ? KOSONG : { jenis: "teks", teks: sst[i] };
      }
      case "inlineStr": {
        const t = m.is?.join("") ?? v ?? "";
        return t === "" ? KOSONG : { jenis: "teks", teks: t };
      }
      case "str":
        return v === null || v === "" ? KOSONG : { jenis: "teks", teks: v };
      case "b":
        return v === null ? KOSONG : v === "1" || v === "true" ? { jenis: "boolean", nilai: true } : v === "0" || v === "false" ? { jenis: "boolean", nilai: false } : { jenis: "galat", teks: "boolean tidak valid" };
      case "e":
        return { jenis: "galat", teks: v ?? "galat" };
      case "d": {
        if (v === null || v === "") return KOSONG;
        const d = tanggalDariIso(v);
        return d ? { jenis: "tanggal", tanggal: d } : { jenis: "galat", teks: "tanggal tidak valid" };
      }
      case "n":
      case "": {
        if (v === null || v.trim() === "") return KOSONG;
        const n = Number(v);
        if (!Number.isFinite(n)) return { jenis: "galat", teks: "angka tidak valid" };
        if (xfTanggal[m.s]) {
          const d = tanggalDariSeri(n);
          return d ? { jenis: "tanggal", tanggal: d } : { jenis: "galat", teks: "tanggal tidak valid" };
        }
        return { jenis: "angka", angka: n };
      }
      default:
        return { jenis: "galat", teks: "jenis sel tidak dikenal" };
    }
  };

  telusuri(xml, (e) => {
    if (!NS_UTAMA.has(e.uri)) return;
    if (e.local === "row") {
      barisSaatIni = e.attr.r ? Number(e.attr.r) : barisSaatIni + 1;
      kolomSaatIni = 0;
      if (!Number.isInteger(barisSaatIni) || barisSaatIni < 1) throw new XlsxTidakTerbaca(`Sheet ${nama}: nomor baris rusak.`);
      if (barisSaatIni > batas.baris) throw new XlsxTidakTerbaca(`Sheet ${nama}: terlalu banyak baris.`);
    } else if (e.local === "c") {
      const pos = e.attr.r ? kolomDariRef(e.attr.r) : { r: barisSaatIni, c: kolomSaatIni + 1 };
      if (!pos || (e.attr.r && pos.r !== barisSaatIni)) throw new XlsxTidakTerbaca(`Sheet ${nama}: alamat sel rusak.`);
      kolomSaatIni = pos.c;
      sel = { r: pos.r, c: pos.c, t: e.attr.t ?? "", s: Number(e.attr.s ?? 0), v: null, f: false, is: null };
    } else if (sel) {
      if (e.local === "v") { sel.v = []; tangkap = sel.v; }
      else if (e.local === "f") sel.f = true;
      else if (e.local === "is") { dalamIs = true; sel.is = []; }
      else if (e.local === "rPh") dalamRph += 1;
      else if (e.local === "t" && dalamIs && !dalamRph) tangkap = sel.is;
    }
  }, (local, uri) => {
    if (!NS_UTAMA.has(uri)) return;
    if (local === "v" || local === "t") tangkap = null;
    else if (local === "is") dalamIs = false;
    else if (local === "rPh") dalamRph -= 1;
    else if (local === "c" && sel) {
      const hasil = nilai(sel);
      const akhir: Sel = sel.f ? { jenis: "rumus", hasil } : hasil;
      if (akhir.jenis !== "kosong") {
        if (sel.c > batas.kolom) throw new XlsxTidakTerbaca(`Sheet ${nama}: lebih dari ${batas.kolom} kolom.`);
        if (!isi.has(sel.r)) isi.set(sel.r, new Map());
        isi.get(sel.r)!.set(sel.c, akhir);
        maksBaris = Math.max(maksBaris, sel.r);
        maksKolom = Math.max(maksKolom, sel.c);
      }
      sel = null;
    }
  }, (t) => { if (tangkap) tangkap.push(t); });

  return { nama, baris: maksBaris, kolom: maksKolom, sel: (r, c) => isi.get(r)?.get(c) ?? KOSONG };
}
