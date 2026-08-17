import { describe, expect, it } from "vitest";
import {
  normalizeKode, potonganVoucher, voucherBerlaku, voucherStatus, pesanVoucherDitolak,
  ringkasSyarat, type VoucherRow,
} from "../voucher";

const v = (p: Partial<VoucherRow> = {}): VoucherRow => ({
  code: "HEMAT10", tipe: "persen", nilai: 10, is_active: true,
  valid_from: null, valid_until: null,
  max_potongan: null, min_belanja: 0, boleh_gabung_promo: true, ...p,
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
    expect(potonganVoucher(200_000, v())).toBe(20_000);
  });

  it("nominal lebih besar dari tagihan dipotong sebatas tagihan", () => {
    // Tanpa batas ini total transaksi jadi minus dan jurnalnya ikut salah.
    expect(potonganVoucher(50_000, v({ tipe: "nominal", nilai: 75_000 }))).toBe(50_000);
  });

  it("persen di atas 100 tetap maksimal seluruh tagihan", () => {
    expect(potonganVoucher(50_000, v({ nilai: 150 }))).toBe(50_000);
  });

  it("nilai atau dasar tidak masuk akal = tidak memotong", () => {
    expect(potonganVoucher(0, v({ tipe: "nominal", nilai: 10_000 }))).toBe(0);
    expect(potonganVoucher(50_000, v({ tipe: "nominal", nilai: -5 }))).toBe(0);
  });

  it("plafon menahan voucher persen di transaksi besar", () => {
    // Inti permintaan: diskon 10% dengan plafon Rp 10.000. Tanpa plafon,
    // transaksi Rp 5.000.000 kehilangan Rp 500.000 dalam sekali ketik.
    const hemat = v({ nilai: 10, max_potongan: 10_000 });
    expect(potonganVoucher(5_000_000, hemat)).toBe(10_000);
    expect(potonganVoucher(50_000, hemat)).toBe(5_000);   // di bawah plafon: apa adanya
  });

  it("plafon juga berlaku untuk voucher nominal", () => {
    expect(potonganVoucher(500_000, v({ tipe: "nominal", nilai: 50_000, max_potongan: 20_000 }))).toBe(20_000);
  });

  it("plafon nol/negatif diabaikan, bukan menghapus potongan", () => {
    expect(potonganVoucher(200_000, v({ max_potongan: 0 }))).toBe(20_000);
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

  it("belanja di bawah minimum ditolak, pesannya menyebut dua angka", () => {
    const pesan = pesanVoucherDitolak(v({ min_belanja: 100_000 }), "2026-08-01",
      { dasar: 60_000, adaPromoOtomatis: false });
    expect(pesan).toContain("100.000");
    expect(pesan).toContain("60.000");
  });

  it("belanja pas di batas minimum lolos", () => {
    expect(pesanVoucherDitolak(v({ min_belanja: 100_000 }), "2026-08-01",
      { dasar: 100_000, adaPromoOtomatis: false })).toBeNull();
  });

  it("voucher yang tidak boleh digabung ditolak saat promo otomatis jalan", () => {
    const vv = v({ boleh_gabung_promo: false });
    expect(pesanVoucherDitolak(vv, "2026-08-01", { dasar: 100_000, adaPromoOtomatis: true }))
      .toMatch(/tidak bisa digabung/);
    // Tanpa promo berjalan, voucher yang sama tetap boleh dipakai.
    expect(pesanVoucherDitolak(vv, "2026-08-01", { dasar: 100_000, adaPromoOtomatis: false })).toBeNull();
  });

  it("voucher yang boleh digabung tidak terganggu promo", () => {
    expect(pesanVoucherDitolak(v(), "2026-08-01", { dasar: 100_000, adaPromoOtomatis: true })).toBeNull();
  });

  it("masa berlaku diperiksa lebih dulu daripada syarat keranjang", () => {
    // Kasir perlu tahu kodenya memang sudah mati, bukan disuruh menambah belanja
    // untuk voucher yang tidak akan pernah bisa dipakai.
    const pesan = pesanVoucherDitolak(v({ valid_until: "2026-07-01", min_belanja: 999_000 }),
      "2026-08-01", { dasar: 10_000, adaPromoOtomatis: false });
    expect(pesan).toMatch(/kedaluwarsa/);
  });
});

describe("ringkasSyarat", () => {
  it("voucher polos disebut tanpa syarat", () => {
    expect(ringkasSyarat(v())).toBe("tanpa syarat tambahan");
  });

  it("syarat yang aktif dirangkai jadi satu baris", () => {
    expect(ringkasSyarat(v({ max_potongan: 10_000, min_belanja: 100_000, boleh_gabung_promo: false })))
      .toBe("maks Rp 10.000 · min belanja Rp 100.000 · tidak digabung promo");
  });
});

describe("voucher bersasaran (meeting 14 Agustus)", () => {
  const dasar = { dasar: 100_000, adaPromoOtomatis: false };
  const vPelanggan = { ...v(), customer_id: "cust-1" };
  const vGolongan = { ...v(), category_id: "gol-1" };

  it("voucher milik pelanggan lain ditolak", () => {
    expect(pesanVoucherDitolak(vPelanggan, "2026-08-01", { ...dasar, customerId: "cust-2" }))
      .toMatch(/bukan milik pelanggan ini/);
  });

  it("voucher milik pelanggan itu sendiri diterima", () => {
    expect(pesanVoucherDitolak(vPelanggan, "2026-08-01", { ...dasar, customerId: "cust-1" })).toBeNull();
  });

  it("tanpa pelanggan dipilih, voucher bersasaran ditolak", () => {
    expect(pesanVoucherDitolak(vPelanggan, "2026-08-01", { ...dasar, customerId: null }))
      .toMatch(/pilih pelanggannya dulu/i);
  });

  it("voucher golongan hanya untuk golongan itu", () => {
    expect(pesanVoucherDitolak(vGolongan, "2026-08-01", { ...dasar, customerId: "c", categoryId: "gol-1" })).toBeNull();
    expect(pesanVoucherDitolak(vGolongan, "2026-08-01", { ...dasar, customerId: "c", categoryId: "gol-2" }))
      .toMatch(/golongan pelanggan ini/);
  });

  it("voucher tanpa sasaran tetap terbuka untuk siapa pun", () => {
    expect(pesanVoucherDitolak(v(), "2026-08-01", { ...dasar, customerId: null })).toBeNull();
  });
});
