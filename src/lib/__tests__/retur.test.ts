import { describe, expect, it } from "vitest";
import { formatNoRetur, sisaRetur, totalRetur } from "../retur";

describe("formatNoRetur", () => {
  it("format RB/RJ.YYYY.MM.NNNNN", () => {
    expect(formatNoRetur("RB", new Date(2026, 6, 23), 1)).toBe("RB.2026.07.00001");
    expect(formatNoRetur("RJ", new Date(2026, 11, 3), 42)).toBe("RJ.2026.12.00042");
  });
});

describe("sisaRetur", () => {
  it("kurangi retur sebelumnya, item habis hilang", () => {
    expect(sisaRetur({ a: 10, b: 2 }, { a: 4, b: 2 })).toEqual({ a: 6 });
  });
  it("tanpa retur sebelumnya", () => {
    expect(sisaRetur({ a: 3 }, {})).toEqual({ a: 3 });
  });
});

describe("totalRetur", () => {
  it("jumlahkan qty x harga", () => {
    expect(totalRetur([{ qty: 2, harga: 5000 }, { qty: 1, harga: 2500 }])).toBe(12500);
  });
  it("baris kosong = 0", () => {
    expect(totalRetur([])).toBe(0);
  });
});

// ── Refund proporsional & modal retur (temuan simulasi 2026-08-02) ─────────
import { rasioBayar, hargaRefund, modalPerSatuan } from "../retur";

describe("rasioBayar", () => {
  it("tanpa diskon, refund penuh", () => {
    expect(rasioBayar(100_000, 100_000)).toBe(1);
  });

  it("struk berdiskon menghasilkan rasio di bawah 1", () => {
    // Kasus nyata simulasi: kotor 911.000, dibayar 735.500.
    expect(rasioBayar(911_000, 735_500)).toBeCloseTo(0.8074, 3);
  });

  it("data aneh tidak pernah bikin refund membengkak", () => {
    expect(rasioBayar(100_000, 250_000)).toBe(1);   // di-cap di 1
    expect(rasioBayar(0, 50_000)).toBe(1);
    expect(rasioBayar(100_000, -5)).toBe(1);
  });
});

describe("hargaRefund", () => {
  it("harga daftar dipotong sesuai rasio", () => {
    // Royal Canin 285.000 di struk yang dibayar ~80,7% → 230.096,
    // bukan 285.000 penuh seperti sebelum perbaikan.
    expect(hargaRefund(285_000, rasioBayar(911_000, 735_500))).toBe(230_096);
  });

  it("tidak pernah negatif", () => {
    expect(hargaRefund(-100, 1)).toBe(0);
  });
});

describe("modalPerSatuan", () => {
  it("pakai HPP saat barang terjual, bukan harga master", () => {
    // Keluar 3 pcs dengan modal total 600.000 → 200.000/pcs,
    // walau master barang menulis 210.000.
    expect(modalPerSatuan(600_000, 3, 210_000)).toBe(200_000);
  });

  it("struk lama tanpa HPP jatuh ke harga beli master", () => {
    expect(modalPerSatuan(null, 3, 210_000)).toBe(210_000);
    expect(modalPerSatuan(0, 3, 210_000)).toBe(210_000);
  });
});
