import { describe, expect, it } from "vitest";
import {
  TANPA_BAYAR, bayarPerTagihan, sisaTagihan, statusUangTagihan, uangDiterimaTagihan,
} from "../uang-tagihan";

// IND-06: satu perhitungan "sudah dibayar" untuk SEMUA bentuk tagihan klinik.
// Bentuk lama (lunas di meja, tanpa baris pembayaran) dan bentuk baru (DP, campuran,
// tahap rawat inap, pembalikan, terbit ulang) harus sama-sama benar.
describe("uang diterima per tagihan", () => {
  it("checkout biasa satu metode yang lunas di meja: dibayar penuh, sisa nol", () => {
    const inv = { total: 100_000, dp_amount: 0, paid_status: "Lunas", reissued_from: null };
    expect(uangDiterimaTagihan(inv, TANPA_BAYAR)).toBe(100_000);
    expect(sisaTagihan(inv, TANPA_BAYAR)).toBe(0);
    expect(statusUangTagihan(100_000, 100_000)).toBe("Lunas");
  });

  it("DP 40.000 tanpa pelunasan: dibayar 40.000, bukan totalnya", () => {
    const inv = { total: 100_000, dp_amount: 40_000, paid_status: "DP", reissued_from: null };
    expect(uangDiterimaTagihan(inv, TANPA_BAYAR)).toBe(40_000);
    expect(sisaTagihan(inv, TANPA_BAYAR)).toBe(60_000);
    expect(statusUangTagihan(100_000, 40_000)).toBe("DP");
  });

  it("DP yang dilunasi lewat piutang: uang muka kepala + pelunasan susulan", () => {
    const inv = { total: 100_000, dp_amount: 40_000, paid_status: "Lunas", reissued_from: null };
    const bayar = bayarPerTagihan([{ invoice_id: "i1", amount: 60_000 }]).get("i1")!;
    expect(uangDiterimaTagihan(inv, bayar)).toBe(100_000);
    expect(sisaTagihan(inv, bayar)).toBe(0);
  });

  it("checkout campuran: seluruh uangnya ada di baris pembayaran, kepala tagihan nol", () => {
    const inv = { total: 100_000, dp_amount: 0, paid_status: "Lunas", reissued_from: null };
    const bayar = bayarPerTagihan([
      { invoice_id: "i1", amount: 60_000 }, { invoice_id: "i1", amount: 40_000 },
    ]).get("i1")!;
    expect(uangDiterimaTagihan(inv, bayar)).toBe(100_000);
  });

  it("tagihan tahap rawat inap yang baru dibayar sebagian", () => {
    const inv = { total: 300_000, dp_amount: 0, paid_status: "DP", reissued_from: null };
    const bayar = bayarPerTagihan([{ invoice_id: "i1", amount: 100_000 }]).get("i1")!;
    expect(uangDiterimaTagihan(inv, bayar)).toBe(100_000);
    expect(sisaTagihan(inv, bayar)).toBe(200_000);
  });

  it("kwitansi tahap yang dibatalkan: baris positif dan pembaliknya saling meniadakan", () => {
    const inv = { total: 100_000, dp_amount: 0, paid_status: "Lunas", reissued_from: null };
    const bayar = bayarPerTagihan([
      { invoice_id: "i1", amount: 100_000 }, { invoice_id: "i1", amount: -100_000 },
    ]).get("i1")!;
    // Statusnya belum sempat disegarkan pun, uangnya tetap terbaca nol.
    expect(uangDiterimaTagihan(inv, bayar)).toBe(0);
    expect(sisaTagihan(inv, bayar)).toBe(100_000);
    expect(statusUangTagihan(100_000, 0)).toBe("Belum Lunas");
  });

  it("tagihan pengganti hasil terbit ulang: uang lama tidak dihitung dua kali", () => {
    const inv = { total: 100_000, dp_amount: 0, paid_status: "Lunas", reissued_from: "inv-lama" };
    const bayar = bayarPerTagihan([{ invoice_id: "i2", amount: 100_000 }]).get("i2")!;
    expect(uangDiterimaTagihan(inv, bayar)).toBe(100_000);
  });

  it("tagihan pengganti yang kwitansinya kemudian dibatalkan: nol, bukan total", () => {
    const inv = { total: 100_000, dp_amount: 0, paid_status: "Lunas", reissued_from: "inv-lama" };
    const bayar = bayarPerTagihan([
      { invoice_id: "i2", amount: 100_000 }, { invoice_id: "i2", amount: -100_000 },
    ]).get("i2")!;
    expect(uangDiterimaTagihan(inv, bayar)).toBe(0);
  });

  it("beberapa tahap dalam satu kunjungan dijumlahkan per tagihan", () => {
    const peta = bayarPerTagihan([
      { invoice_id: "i1", amount: 100_000 },
      { invoice_id: "i2", amount: 50_000 },
      { invoice_id: "i2", amount: 25_000 },
    ]);
    expect(peta.get("i1")).toEqual({ jumlah: 100_000, baris: 1 });
    expect(peta.get("i2")).toEqual({ jumlah: 75_000, baris: 2 });
  });
});
