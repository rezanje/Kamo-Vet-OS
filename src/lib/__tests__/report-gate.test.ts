import { describe, expect, it } from "vitest";
import { denganTampil, laporanDiminta } from "../report-gate";

describe("gerbang laporan (A1)", () => {
  it("hanya menganggap laporan diminta bila tampil=1", () => {
    expect(laporanDiminta({})).toBe(false);
    expect(laporanDiminta(undefined)).toBe(false);
    expect(laporanDiminta({ dari: "2026-11-01", cabang_id: "x" })).toBe(false);
    expect(laporanDiminta({ tampil: "0" })).toBe(false);
    expect(laporanDiminta({ tampil: "1" })).toBe(true);
    expect(laporanDiminta({ tampil: ["0", "1"] })).toBe(true);
    expect(laporanDiminta(new URLSearchParams("dari=2026-11-01&tampil=1"))).toBe(true);
    expect(laporanDiminta(new URLSearchParams("dari=2026-11-01"))).toBe(false);
  });

  it("menambah tampil=1 ke tautan tanpa membuang parameter lain atau anchor", () => {
    expect(denganTampil("/laporan/penjual")).toBe("/laporan/penjual?tampil=1");
    expect(denganTampil("/keuangan/buku-besar?akun=1-1100&dari=2026-11-01")).toBe("/keuangan/buku-besar?akun=1-1100&dari=2026-11-01&tampil=1");
    expect(denganTampil("/keuangan/jurnal?tampil=1&nomor=JU-1#baris")).toBe("/keuangan/jurnal?tampil=1&nomor=JU-1#baris");
    expect(denganTampil("/pembelian/uang-muka#advance-1")).toBe("/pembelian/uang-muka?tampil=1#advance-1");
    expect(denganTampil("/pos/shift?")).toBe("/pos/shift?tampil=1");
    // Pesan yang sudah di-encode tidak diubah bentuknya (%20 tetap %20).
    expect(denganTampil("/pembelian?error=Status%20PO%20ditolak")).toBe("/pembelian?error=Status%20PO%20ditolak&tampil=1");
  });
});
