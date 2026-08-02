import { describe, expect, it } from "vitest";
import { ATURAN_KOSONG, menitTelat, potonganTelat, type AturanGaji } from "../payroll-aturan";
import { durasiShiftMenit, validasiShift } from "../shift-master";

// Contoh dari PDF tim: Rp10rb tiap 5 menit, mulai menit ke-1, maksimal Rp2 juta.
const aturan: AturanGaji = {
  telat_mulai_menit: 1,
  telat_blok_menit: 5,
  telat_nominal_per_blok: 10000,
  telat_maks: 2000000,
  bolos_per_hari: 150000,
  lembur_per_jam: 20000,
};

describe("potonganTelat", () => {
  it("tepat kelipatan blok", () => {
    expect(potonganTelat(5, aturan)).toBe(10000);
    expect(potonganTelat(10, aturan)).toBe(20000);
  });

  it("blok belum penuh tetap dihitung penuh", () => {
    expect(potonganTelat(1, aturan)).toBe(10000);
    expect(potonganTelat(6, aturan)).toBe(20000);
  });

  it("tidak telat = tidak dipotong", () => {
    expect(potonganTelat(0, aturan)).toBe(0);
    expect(potonganTelat(-5, aturan)).toBe(0);
  });

  it("di bawah batas bawah tidak dipotong", () => {
    const longgar = { ...aturan, telat_mulai_menit: 10 };
    expect(potonganTelat(9, longgar)).toBe(0);
    expect(potonganTelat(10, longgar)).toBe(20000);
  });

  it("kena batas atas", () => {
    expect(potonganTelat(1000, aturan)).toBe(2000000);
    expect(potonganTelat(5000, aturan)).toBe(2000000);
  });

  it("batas atas 0 = tanpa batas", () => {
    expect(potonganTelat(1000, { ...aturan, telat_maks: 0 })).toBe(2000000);
    expect(potonganTelat(2000, { ...aturan, telat_maks: 0 })).toBe(4000000);
  });

  it("aturan bawaan (belum diisi pemilik) tidak memotong apa pun", () => {
    expect(potonganTelat(120, ATURAN_KOSONG)).toBe(0);
  });
});

describe("menitTelat", () => {
  it("selisih jam absen dengan jam shift", () => {
    expect(menitTelat("08:00", "08:17")).toBe(17);
    expect(menitTelat("13:00:00", "13:05:00")).toBe(5);
  });

  it("datang lebih awal bukan telat negatif", () => {
    expect(menitTelat("08:00", "07:45")).toBe(0);
  });

  it("data tidak lengkap dianggap tidak telat", () => {
    expect(menitTelat(null, "09:00")).toBe(0);
    expect(menitTelat("08:00", null)).toBe(0);
  });
});

describe("shift", () => {
  it("shift lewat tengah malam dihitung memutar", () => {
    expect(durasiShiftMenit("21:00", "05:00")).toBe(480);
    expect(durasiShiftMenit("08:00", "17:00")).toBe(540);
  });

  it("shift kerja wajib punya jam, shift libur tidak", () => {
    expect(validasiShift({ nama: "Pagi", isLibur: false, jamMasuk: "", jamPulang: "17:00" })).toBeTruthy();
    expect(validasiShift({ nama: "Libur", isLibur: true, jamMasuk: "", jamPulang: "" })).toBeNull();
    expect(validasiShift({ nama: "", isLibur: true, jamMasuk: "", jamPulang: "" })).toBeTruthy();
  });
});
