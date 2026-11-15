import { describe, expect, it } from "vitest";
import { bacaBatasTanggal, bacaTanggalEfektif, batasCadangan, batasKolom, catatanTanggalEfektif, perluAlasanTanggal, tanggalId, tanggalIsoValid, tanggalWibDariWaktu } from "@/lib/tanggal-efektif-petshop";

describe("tanggalIsoValid / tanggalId", () => {
  it("menerima hanya tanggal kalender nyata", () => {
    expect(tanggalIsoValid("2026-11-12")).toBe(true);
    expect(tanggalIsoValid("2028-02-29")).toBe(true);
    for (const bad of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-00-10", "12/11/2026", "", "2026-1-1", " 2026-11-12"]) expect(tanggalIsoValid(bad)).toBe(false);
  });
  it("format Indonesia hari/bulan/tahun; teks tak valid dikembalikan apa adanya", () => {
    expect(tanggalId("2026-11-02")).toBe("02/11/2026");
    expect(tanggalId("bukan")).toBe("bukan");
  });
});

describe("bacaTanggalEfektif", () => {
  const hariIni = "2026-11-12";
  it("kosong atau bukan teks = tidak memilih (hari ini)", () => {
    expect(bacaTanggalEfektif(null, hariIni)).toBeNull();
    expect(bacaTanggalEfektif("", hariIni)).toBeNull();
    expect(bacaTanggalEfektif("   ", hariIni)).toBeNull();
    expect(bacaTanggalEfektif(new File([], "x"), hariIni)).toBeNull();
  });
  it("hari ini dan hari-hari sebelumnya diterima; spasi dipangkas", () => {
    expect(bacaTanggalEfektif("2026-11-12", hariIni)).toBe("2026-11-12");
    expect(bacaTanggalEfektif(" 2026-11-11 ", hariIni)).toBe("2026-11-11");
    expect(bacaTanggalEfektif("2025-01-01", hariIni)).toBe("2025-01-01");
  });
  it("masa depan dan tanggal tak valid ditolak dengan kalimat jelas (bukan diam-diam hari ini)", () => {
    expect(() => bacaTanggalEfektif("2026-11-13", hariIni)).toThrow(/13\/11\/2026 belum tiba \(hari ini 12\/11\/2026\)/);
    expect(() => bacaTanggalEfektif("2026-02-30", hariIni)).toThrow(/tidak valid/);
    expect(() => bacaTanggalEfektif("kemarin", hariIni)).toThrow(/tidak valid/);
  });
});

describe("perluAlasanTanggal", () => {
  it("alasan wajib hanya untuk tanggal sebelum hari ini", () => {
    expect(perluAlasanTanggal(null, "2026-11-12")).toBe(false);
    expect(perluAlasanTanggal("2026-11-12", "2026-11-12")).toBe(false);
    expect(perluAlasanTanggal("2026-11-11", "2026-11-12")).toBe(true);
  });
});

describe("bacaBatasTanggal / batasCadangan / batasKolom", () => {
  const rpc = { min_date: "2026-11-05", max_date: "2026-11-12", today: "2026-11-12", closed_until: "2026-11-08", effective_min: "2026-11-09", can_backdate: true };
  it("membaca jawaban RPC pos_receipt_date_bounds", () => {
    expect(bacaBatasTanggal(rpc)).toEqual({ min: "2026-11-05", max: "2026-11-12", closedUntil: "2026-11-08", effectiveMin: "2026-11-09", canBackdate: true });
    expect(bacaBatasTanggal({ ...rpc, closed_until: null })!.closedUntil).toBeNull();
    expect(bacaBatasTanggal({ ...rpc, can_backdate: "true" })!.canBackdate).toBe(false);
  });
  it("bentuk tak dikenal = null (layar memakai batas cadangan)", () => {
    for (const bad of [null, undefined, "x", 5, {}, { ...rpc, min_date: "kemarin" }, { ...rpc, effective_min: null }]) expect(bacaBatasTanggal(bad)).toBeNull();
  });
  it("batas cadangan: Owner tidak dikunci layar (boleh mundur sampai tanggal struk); peran lain hanya hari ini", () => {
    expect(batasCadangan("2026-11-05", true, "2026-11-12")).toEqual({ min: "2026-11-05", max: "2026-11-12", closedUntil: null, effectiveMin: "2026-11-05", canBackdate: true });
    expect(batasCadangan("2026-11-05", false, "2026-11-12")).toEqual({ min: "2026-11-12", max: "2026-11-12", closedUntil: null, effectiveMin: "2026-11-12", canBackdate: false });
    expect(batasCadangan("", true, "2026-11-12").min).toBe("2026-11-12");
    expect(batasCadangan("2027-01-01", true, "2026-11-12").min).toBe("2026-11-12");
  });
  it("kolom tanggal: min tidak pernah melewati max (periode tertutup sampai hari ini)", () => {
    expect(batasKolom({ min: "2026-11-05", max: "2026-11-12", closedUntil: "2026-11-12", effectiveMin: "2026-11-13", canBackdate: true })).toEqual({ min: "2026-11-12", max: "2026-11-12" });
    expect(batasKolom(bacaBatasTanggal(rpc)!)).toEqual({ min: "2026-11-09", max: "2026-11-12" });
  });
});

describe("tanggalWibDariWaktu / catatanTanggalEfektif", () => {
  it("memakai tanggal WIB, bukan UTC", () => {
    expect(tanggalWibDariWaktu("2026-11-11T18:30:00Z")).toBe("2026-11-12");
    expect(tanggalWibDariWaktu("2026-11-11T16:59:00Z")).toBe("2026-11-11");
    expect(tanggalWibDariWaktu("bukan waktu")).toBe("");
  });
  it("catatan hanya muncul bila tanggal efektif beda dari tanggal catat", () => {
    expect(catatanTanggalEfektif("2026-11-10", "2026-11-12T03:00:00Z")).toBe("Dibukukan di tanggal 10/11/2026 (dicatat 12/11/2026)");
    expect(catatanTanggalEfektif("2026-11-12", "2026-11-12T03:00:00Z")).toBeNull();
    expect(catatanTanggalEfektif(null, "2026-11-12T03:00:00Z")).toBeNull();
    expect(catatanTanggalEfektif("2026-11-10", null)).toBe("Dibukukan di tanggal 10/11/2026");
  });
});
