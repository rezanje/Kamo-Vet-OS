import { describe, expect, it } from "vitest";
import { normalizeKode, potonganVoucher, voucherBerlaku, voucherStatus, pesanVoucherDitolak, type VoucherRow } from "../voucher";

const v = (p: Partial<VoucherRow> = {}): VoucherRow => ({
  code: "HEMAT10", tipe: "persen", nilai: 10, is_active: true,
  valid_from: null, valid_until: null, ...p,
});

describe("normalizeKode", () => {
  it("huruf & spasi seadanya menemukan baris yang sama", () => {
    expect(normalizeKode("hemat10")).toBe("HEMAT10");
    expect(normalizeKode(" HEMAT 10 ")).toBe("HEMAT10");
  });
});

describe("voucherBerlaku", () => {
  it("tanpa tanggal = selalu berlaku selama aktif", () => {
    expect(voucherBerlaku(v(), "2026-08-01")).toBe(true);
    expect(voucherBerlaku(v({ is_active: false }), "2026-08-01")).toBe(false);
  });

  it("tanggal akhir bersifat inklusif", () => {
    expect(voucherBerlaku(v({ valid_until: "2026-08-01" }), "2026-08-01")).toBe(true);
    expect(voucherBerlaku(v({ valid_until: "2026-08-01" }), "2026-08-02")).toBe(false);
  });

  it("belum mulai = belum berlaku", () => {
    expect(voucherBerlaku(v({ valid_from: "2026-08-05" }), "2026-08-01")).toBe(false);
  });
});

describe("potonganVoucher", () => {
  it("persen dihitung dari dasar", () => {
    expect(potonganVoucher(200_000, "persen", 10)).toBe(20_000);
  });

  it("nominal lebih besar dari tagihan dipotong sebatas tagihan", () => {
    // Tanpa batas ini total transaksi jadi minus dan jurnalnya ikut salah.
    expect(potonganVoucher(50_000, "nominal", 75_000)).toBe(50_000);
  });

  it("persen di atas 100 tetap maksimal seluruh tagihan", () => {
    expect(potonganVoucher(50_000, "persen", 150)).toBe(50_000);
  });

  it("nilai atau dasar tidak masuk akal = tidak memotong", () => {
    expect(potonganVoucher(0, "nominal", 10_000)).toBe(0);
    expect(potonganVoucher(50_000, "nominal", -5)).toBe(0);
  });
});

describe("pesanVoucherDitolak", () => {
  it("voucher sehat lolos tanpa pesan", () => {
    expect(pesanVoucherDitolak(v(), "2026-08-01")).toBeNull();
  });

  it("alasan penolakan dibedakan", () => {
    expect(pesanVoucherDitolak(null, "2026-08-01")).toMatch(/tidak ditemukan/);
    expect(pesanVoucherDitolak(v({ valid_until: "2026-07-01" }), "2026-08-01")).toMatch(/kedaluwarsa/);
    expect(pesanVoucherDitolak(v({ valid_from: "2026-09-01" }), "2026-08-01")).toMatch(/baru berlaku/);
    expect(pesanVoucherDitolak(v({ is_active: false }), "2026-08-01")).toMatch(/dinonaktifkan/);
  });

  it("status konsisten dengan berlaku/tidaknya", () => {
    expect(voucherStatus(v({ valid_from: "2026-09-01" }), "2026-08-01")).toBe("terjadwal");
  });
});
