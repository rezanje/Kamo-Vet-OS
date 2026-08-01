import { describe, expect, it } from "vitest";
import { samaNama } from "../anabul";
import { nomorHpValid, digitHp } from "../kontak";

// samaNama harus persis mengikuti aturan index `pets_nama_unik_per_pemilik`
// (lower(btrim(name))) — kalau meleset, cek aplikasi meloloskan yang ditolak DB
// dan staff kena pesan error mentah dari database.
describe("samaNama", () => {
  it("beda huruf besar/kecil dianggap sama", () => {
    expect(samaNama("Michi", "michi")).toBe(true);
    expect(samaNama("MICHI", "Michi")).toBe(true);
  });

  it("spasi pinggir diabaikan", () => {
    expect(samaNama("  Michi ", "Michi")).toBe(true);
  });

  it("nama berbeda tetap berbeda", () => {
    expect(samaNama("Michi", "Miche")).toBe(false);
    expect(samaNama("Michi", "Michi 2")).toBe(false);
  });
});

describe("nomorHpValid", () => {
  it("nomor wajar diterima apa pun format tulisannya", () => {
    expect(nomorHpValid("085710790002")).toBe(true);
    expect(nomorHpValid("+62 857-1079-0002")).toBe(true);
    expect(nomorHpValid("(021) 1234567")).toBe(true);
  });

  it("isian asal ditolak", () => {
    expect(nomorHpValid("0")).toBe(false);        // kasus nyata di data 2026-08-01
    expect(nomorHpValid("00000000")).toBe(false);
    expect(nomorHpValid("1111111111")).toBe(false);
    expect(nomorHpValid("")).toBe(false);
    expect(nomorHpValid("12345")).toBe(false);    // terlalu pendek
  });

  it("digitHp membuang semua pemisah", () => {
    expect(digitHp("+62 857-1079-0002")).toBe("6285710790002");
  });
});
