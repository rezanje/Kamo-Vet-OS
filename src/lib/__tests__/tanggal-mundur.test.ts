import { describe, expect, it } from "vitest";
import {
  ALASAN_MAX, ALASAN_MIN, BATAS_HARI_MUNDUR, batasTanggalMundur, cekTanggalMundur, formatTanggalID, geserTanggalISO,
  penolakanTanggalMundurDB, pesanDicatatDi, tanggalSah,
} from "@/lib/tanggal-mundur";

const today = "2026-11-23";

describe("tanggal-mundur (aturan sama dengan database)", () => {
  it("konstanta: 31 hari, alasan 3-200", () => {
    expect([BATAS_HARI_MUNDUR, ALASAN_MIN, ALASAN_MAX]).toEqual([31, 3, 200]);
  });
  it("batas paling awal = hari ini - 31 (lintas bulan dan tahun)", () => {
    expect(batasTanggalMundur(today)).toBe("2026-10-23");
    expect(batasTanggalMundur("2026-01-10")).toBe("2025-12-10");
    expect(geserTanggalISO("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("tanggalSah menolak tanggal yang tidak ada", () => {
    expect(tanggalSah("2026-02-28")).toBe(true);
    expect(tanggalSah("2026-02-31")).toBe(false);
    expect(tanggalSah("2026-2-3")).toBe(false);
    expect(tanggalSah("")).toBe(false);
  });
  it("hari ini / kosong = bukan mundur, tanpa alasan", () => {
    expect(cekTanggalMundur({ tanggal: today, alasan: "abaikan", today })).toEqual({ ok: true, tanggal: today, mundur: false, alasan: null });
    expect(cekTanggalMundur({ tanggal: "", alasan: null, today })).toEqual({ ok: true, tanggal: today, mundur: false, alasan: null });
    expect(cekTanggalMundur({ tanggal: undefined, alasan: undefined, today })).toMatchObject({ ok: true, mundur: false });
  });
  it("mundur beralasan: diterima (alasan dirapikan), batas 31 hari tepat diterima", () => {
    expect(cekTanggalMundur({ tanggal: "2026-11-22", alasan: "  nota terlupa ", today })).toEqual({ ok: true, tanggal: "2026-11-22", mundur: true, alasan: "nota terlupa" });
    expect(cekTanggalMundur({ tanggal: "2026-10-23", alasan: "abc", today })).toMatchObject({ ok: true, mundur: true });
  });
  it("ditolak: tanpa alasan, alasan 2 / 201 huruf, 32 hari, masa depan, tidak sah", () => {
    for (const alasan of [null, "", "  ", "ab", "x".repeat(201)]) {
      const r = cekTanggalMundur({ tanggal: "2026-11-22", alasan, today });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/alasan 3-200/);
    }
    const lama = cekTanggalMundur({ tanggal: "2026-10-22", alasan: "terlalu lama", today });
    expect(lama.ok).toBe(false);
    if (!lama.ok) expect(lama.message).toMatch(/31 hari/);
    const depan = cekTanggalMundur({ tanggal: "2026-11-24", alasan: "besok", today });
    expect(depan.ok).toBe(false);
    if (!depan.ok) expect(depan.message).toMatch(/masa depan/);
    expect(cekTanggalMundur({ tanggal: "2026-13-01", alasan: "salah", today }).ok).toBe(false);
  });
  it("format dan banner", () => {
    expect(formatTanggalID("2026-11-05")).toBe("05/11/2026");
    expect(pesanDicatatDi("2026-11-21", today)).toBe("Pengeluaran ini dicatat di tanggal 21/11/2026 (diinput 23/11/2026).");
  });
  it("pesan penolakan database", () => {
    expect(penolakanTanggalMundurDB("Tanggal mundur: rekonsiliasi bank sudah mencakup", true)).toMatch(/BELUM tersimpan/);
    expect(penolakanTanggalMundurDB("Tanggal mundur: alasan wajib", false)).toMatch(/BELUM tersimpan/);
    expect(penolakanTanggalMundurDB("Periode akuntansi sudah ditutup", true)).toMatch(/tanggal itu sudah ditutup/);
    expect(penolakanTanggalMundurDB("Periode akuntansi sudah ditutup", false)).toBeNull();
    expect(penolakanTanggalMundurDB("Akses pengeluaran ditolak.", true)).toBeNull();
    expect(penolakanTanggalMundurDB(undefined, true)).toBeNull();
  });
});
