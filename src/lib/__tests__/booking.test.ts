import { describe, it, expect } from "vitest";
import { composeBookingScheduledAt, validasiBooking, normalPhone, type BookingDraft } from "../booking";

const dasar: BookingDraft = {
  branchId: "b1", poli: "Poli Umum", tanggal: "2026-08-10", jam: "09:00",
  namaPemilik: "Andi", phone: "081234567890", namaHewan: "Michi",
  jenisHewan: "Kucing", keluhan: "batuk",
};
const hariIni = "2026-08-06";

describe("normalPhone", () => {
  it("menyeragamkan +62 / 62 / spasi jadi 08...", () => {
    expect(normalPhone("+62 812-3456-7890")).toBe("081234567890");
    expect(normalPhone("6281234567890")).toBe("081234567890");
    expect(normalPhone("0812 3456 7890")).toBe("081234567890");
  });
});

describe("validasiBooking", () => {
  it("isian lengkap lolos", () => {
    expect(validasiBooking(dasar, hariIni)).toBeNull();
  });

  it("hari ini masih boleh, kemarin ditolak", () => {
    expect(validasiBooking({ ...dasar, tanggal: hariIni }, hariIni)).toBeNull();
    expect(validasiBooking({ ...dasar, tanggal: "2026-08-05" }, hariIni)).toMatch(/lewat/i);
  });

  it("dibatasi 60 hari ke depan", () => {
    expect(validasiBooking({ ...dasar, tanggal: "2026-10-05" }, hariIni)).toBeNull();      // 60 hari
    expect(validasiBooking({ ...dasar, tanggal: "2026-10-06" }, hariIni)).toMatch(/60 hari/);
  });

  it("menolak jam di luar jam buka & poli asing", () => {
    expect(validasiBooking({ ...dasar, jam: "03:00" }, hariIni)).toMatch(/jam/i);
    expect(validasiBooking({ ...dasar, poli: "Poli Palsu" }, hariIni)).toMatch(/layanan/i);
  });

  it("menolak nomor HP ngawur", () => {
    expect(validasiBooking({ ...dasar, phone: "12345" }, hariIni)).toMatch(/HP/);
    expect(validasiBooking({ ...dasar, phone: "abcdefghij" }, hariIni)).toMatch(/HP/);
  });

  it("menolak keluhan kepanjangan (batas simpanan)", () => {
    expect(validasiBooking({ ...dasar, keluhan: "x".repeat(501) }, hariIni)).toMatch(/panjang/i);
  });
});

describe("composeBookingScheduledAt", () => {
  it("membentuk instant Asia/Jakarta tanpa bergantung locale browser", () => {
    expect(composeBookingScheduledAt("2026-08-31", "09:30")).toBe("2026-08-31T09:30:00+07:00");
  });
});
