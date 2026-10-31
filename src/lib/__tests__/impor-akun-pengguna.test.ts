import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bacaTabelCsv, rencanakanCoaPengguna, type KonteksImporAkun } from "../impor-akun";
import { bacaTabelXlsx } from "../impor-akun-xlsx";
import { PEMETAAN_AKUN } from "../impor-akun-pemetaan";

// SYNTHETIC fixture with the structure Reza described from the user's COA.xlsx (raw file not uploaded).
const dir = new URL("../../../supabase/tests/fixtures/", import.meta.url);
const XLSX = readFileSync(new URL("coa-pengguna-sintetis.xlsx", dir));
const CSV = readFileSync(new URL("coa-pengguna-sintetis.csv", dir), "utf8");
const SHA_XLSX = "cc7d84f77dbd40693f60d5b04ba4f47f4baf3736e9d50822dbd6a4144ee703ff";
const SHA_CSV = "a98181310f7bfbe9b605aaa673aadf04afdc97d8dce224e29ece531be1e6e469";
const P = PEMETAAN_AKUN["pengguna-kode-nama-normal"];
const kosong: KonteksImporAkun = { versi: "v", akun: [], pemakaian: {} };

async function dariXlsx(ctx = kosong) {
  const t = await bacaTabelXlsx(new Uint8Array(XLSX), P);
  if (!t.ok) throw new Error(t.pesan);
  return rencanakanCoaPengguna(t.tabel, P, ctx);
}
function dariCsv(isi: string, ctx = kosong) {
  const r = rencanakanCoaPengguna(bacaTabelCsv(isi), P, ctx);
  return r;
}

describe("synthetic user COA file (Kode | Nama Akun | Normal)", () => {
  it("is pinned by SHA-256", () => {
    expect(createHash("sha256").update(XLSX).digest("hex")).toBe(SHA_XLSX);
    expect(createHash("sha256").update(CSV).digest("hex")).toBe(SHA_CSV);
    expect(P.ditinjau.fixtureSha256).toBe(SHA_XLSX);
  });

  it("finds the header on row 4 by exact text and shows the 3 preamble rows as skipped", async () => {
    const r = await dariXlsx();
    if (!r.ok) throw new Error(r.pesan);
    expect(r.sheet).toBe("Sheet1");
    expect(r.barisJudul).toBe(4);
    expect(r.pembuka.map((p) => p.baris)).toEqual([1, 2, 3]);
    expect(r.pembuka.every((p) => /sebelum judul kolom/.test(p.alasan))).toBe(true);
    expect(r.kolomDipetakan).toEqual([
      { sumber: "Kode", tujuan: "kode" }, { sumber: "Nama Akun", tujuan: "nama" }, { sumber: "Normal", tujuan: "saldo_normal" }]);
  });

  it("accounts for all 204 data rows with sheet+row provenance; counts reconcile", async () => {
    const r = await dariXlsx();
    if (!r.ok) throw new Error(r.pesan);
    expect(r.jumlah).toEqual({ totalData: 204, menunggu_pemetaan: 177, sudah_ada: 0, ditahan: 27, konflik: 0, ditolak: 0 });
    const { totalData, ...kategori } = r.jumlah;
    expect(Object.values(kategori).reduce((a, b) => a + b, 0)).toBe(totalData);
    expect(r.baris).toHaveLength(204);
    expect(r.baris.map((b) => b.sumber.baris)).toEqual(Array.from({ length: 204 }, (_, i) => i + 5));
    expect(r.baris.every((b) => b.sumber.sheet === "Sheet1")).toBe(true);
    expect(r.kodeUnik).toBe(179);
    expect(r.baris.every((b) => /^\d{6}$/.test(b.kode))).toBe(true);
    expect(r.normalSumber).toEqual({ Debit: 150, Kredit: 54, lain: 0 });
    expect(r.kosong).toEqual([]);
  });

  it("holds every row of a repeated code (21×110001, 6×120001) without merging or renumbering", async () => {
    const r = await dariXlsx();
    if (!r.ok) throw new Error(r.pesan);
    const ditahan = r.baris.filter((b) => b.status === "ditahan");
    expect(ditahan.filter((b) => b.kode === "110001")).toHaveLength(21);
    expect(ditahan.filter((b) => b.kode === "120001")).toHaveLength(6);
    expect(new Set(ditahan.map((b) => b.nama)).size).toBe(27);
    expect(ditahan[0].alasan.join(" ")).toMatch(/110001 muncul di 21 baris/);
    expect(ditahan[0].alasan.join(" ")).toMatch(/tidak digabung/);
    expect(ditahan[0].solusi).toMatch(/Finance|pemilik/);
  });

  it("shows source Normal with provenance and the first-digit group only as an unapproved proposal", async () => {
    const r = await dariXlsx();
    if (!r.ok) throw new Error(r.pesan);
    const kontra = r.baris.find((b) => b.kode === "150901")!;
    expect(kontra).toMatchObject({ normalSumber: "Kredit", usulanKelompok: "ASET" });
    expect(kontra.catatanNormal).toMatch(/tinjauan Finance/);
    // Bagan akun 6 digit: 5xxxxx = pendapatan; fixture lama berisi "beban" Debit → diberi catatan tinjauan.
    expect(r.baris.find((b) => b.kode === "510101")).toMatchObject({ usulanKelompok: "PENDAPATAN" });
    expect(r.baris.find((b) => b.kode === "510101")!.catatanNormal).toMatch(/tinjauan Finance/);
    expect(r.baris.find((b) => b.kode === "110101")).toMatchObject({ usulanKelompok: "ASET", catatanNormal: null });
    expect(r.catatanUsulan).toMatch(/usulan.*belum disetujui/i);
  });

  it("saving is disabled for this profile and every missing decision is listed", async () => {
    const r = await dariXlsx();
    if (!r.ok) throw new Error(r.pesan);
    expect(r.bolehSimpan).toBe(false);
    const teks = r.terblokir.join(" ");
    for (const kata of [/kelompok/i, /induk/i, /header|posting/i, /110001/, /Normal/]) expect(teks).toMatch(kata);
    expect(r).not.toHaveProperty("kirim");
  });

  it("CSV export of the same structure gives the same reconciliation", () => {
    const r = dariCsv(CSV);
    if (!r.ok) throw new Error(r.pesan);
    expect(r.sheet).toBe("CSV");
    expect(r.barisJudul).toBe(4);
    expect(r.jumlah).toEqual({ totalData: 204, menunggu_pemetaan: 177, sudah_ada: 0, ditahan: 27, konflik: 0, ditolak: 0 });
    expect(r.kodeUnik).toBe(179);
  });

  it("existing KAMO codes are shown as already-present with a diff, still not saved", () => {
    const r = dariCsv(CSV, { versi: "v", pemakaian: {}, akun: [
      { id: "x", code: "110101", name: "Kas Lama", type: "ASET", normal_balance: "D", is_header: false, is_active: true, parent_id: null }] });
    if (!r.ok) throw new Error(r.pesan);
    const b = r.baris.find((x) => x.kode === "110101")!;
    expect(b.status).toBe("sudah_ada");
    expect(b.perubahan).toEqual([{ kolom: "nama", lama: "Kas Lama", baru: "Kas Operasional Fiktif 01" }]);
    expect(r.jumlah).toMatchObject({ menunggu_pemetaan: 176, sudah_ada: 1 });
    expect(r.bolehSimpan).toBe(false);
  });

  it("rejects bad Normal / empty names, flags non-KAMO code formats, counts blank rows separately", () => {
    const r = dariCsv("Judul\n\nKode,Nama Akun,Normal\n510001,Beban A,Debet?\n510002,,Debit\n51.0003,Beban C,Debit\n\n510004,Beban D,Kredit\n");
    if (!r.ok) throw new Error(r.pesan);
    expect(r.barisJudul).toBe(3);
    expect(r.baris.map((b) => [b.sumber.baris, b.status])).toEqual([[4, "ditolak"], [5, "ditolak"], [6, "konflik"], [8, "menunggu_pemetaan"]]);
    expect(r.kosong).toEqual([{ baris: 7, alasan: "Baris kosong dilewati." }]);
    expect(r.jumlah.totalData).toBe(4);
  });

  it("does not guess the header position: misspelled header is an error", () => {
    expect(dariCsv("a\nb\nc\nKode,Nama akun,Normal\n510001,X,Debit").ok).toBe(false);
    expect(dariCsv("510001,X,Debit\n510002,Y,Kredit").ok).toBe(false);
  });

  it("the xlsx reader requires the profile's sheet", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const b = new ExcelJS.Workbook(); b.addWorksheet("Lain").addRow(["Kode", "Nama Akun", "Normal"]);
    const t = await bacaTabelXlsx(new Uint8Array(await b.xlsx.writeBuffer() as ArrayBuffer), P);
    expect(t.ok).toBe(false);
  });
});

describe("mapping registry", () => {
  it("contains the KAMO template and the user-file profile only; nothing is named Accurate", () => {
    expect(Object.keys(PEMETAAN_AKUN)).toEqual(["kamo", "pengguna-kode-nama-normal"]);
    expect(P.label).toBe("file COA pengguna (Kode/Nama Akun/Normal)");
    expect(JSON.stringify(PEMETAAN_AKUN)).not.toMatch(/accurate/i);
  });
});
