import { describe, expect, it } from "vitest";
import { parseClinicPostingError } from "../klinik-posting";
import { parseBagianPelunasan, pesanPelunasanGagal, sisaTagihan, totalBagian } from "../pelunasan-klinik";

describe("produk saja wajib lunas", () => {
  it("menerjemahkan penolakan writer menjadi pesan kasir yang jelas", () => {
    const pesan = parseClinicPostingError({ code: "P0001", message: "PRODUCT_ONLY_FULL_PAYMENT: pembelian produk saja wajib dibayar lunas" });
    expect(pesan).toMatch(/^Pembelian produk saja wajib dibayar lunas\./);
    expect(pesan).toMatch(/Tunai\/Transfer/);
    expect(pesan).not.toMatch(/PRODUCT_ONLY/);
  });
});

describe("pelunasan DP lama", () => {
  it("menghitung sisa dari uang yang menempel sekali", () => {
    expect(sisaTagihan(50000, 30000)).toBe(20000);
    expect(sisaTagihan(50000, 50000)).toBe(0);
    expect(sisaTagihan(50000, 60000)).toBe(0);
  });

  it("menerima campuran Tunai dan Transfer", () => {
    const parts = parseBagianPelunasan(JSON.stringify([{ method: "Tunai", amount: 5000 }, { method: "Transfer", amount: 15000 }]));
    expect(parts).toEqual([{ method: "Tunai", amount: 5000 }, { method: "Transfer", amount: 15000 }]);
    expect(totalBagian(parts)).toBe(20000);
  });

  it.each([
    ["bukan JSON", "x"],
    ["kosong", "[]"],
    ["lebih dari enam", JSON.stringify(Array.from({ length: 7 }, () => ({ method: "Tunai", amount: 1 })))],
    ["metode asing", JSON.stringify([{ method: "Cek", amount: 1000 }])],
    ["nol", JSON.stringify([{ method: "Tunai", amount: 0 }])],
    ["pecahan", JSON.stringify([{ method: "Tunai", amount: 100.5 }])],
    ["negatif", JSON.stringify([{ method: "Tunai", amount: -5 }])],
  ])("menolak isian %s", (_label, raw) => {
    expect(() => parseBagianPelunasan(raw)).toThrow();
  });

  it("menjelaskan penolakan basis data tanpa membocorkan kode", () => {
    expect(pesanPelunasanGagal({ code: "P0001", message: "REMAINING_CHANGED: sisa tagihan sekarang Rp 15000" }))
      .toBe("Sisa tagihan sudah berubah (sisa tagihan sekarang Rp 15000). Muat ulang halaman dan periksa lagi; pelunasan ini belum tersimpan.");
    expect(pesanPelunasanGagal({ code: "P0001", message: "SETTLE_INVALID: tagihan sudah lunas" }))
      .toBe("Pelunasan ditolak: tagihan sudah lunas. Tidak ada uang yang tersimpan.");
    expect(pesanPelunasanGagal({ code: "P0001", message: "PAYMENT_INVALID: pelunasan melebihi sisa tagihan" }))
      .toMatch(/melebihi sisa tagihan/);
    expect(pesanPelunasanGagal({ code: "P0001", message: "IDEMPOTENCY_CONFLICT: kunci pembayaran dipakai untuk data berbeda" }))
      .toMatch(/Muat ulang/);
    expect(pesanPelunasanGagal({ code: "P0001", message: "SHIFT_INVALID: shift klinik aktif tidak ditemukan" }))
      .toBe("Shift klinik sudah tidak aktif. Periksa shift lalu coba lagi.");
    expect(pesanPelunasanGagal({ code: "P0001", message: "STAGE_RECEIPT: terima uang rawat inap lewat layar Tagihan rawat inap" }))
      .toMatch(/Tagihan rawat inap/);
    expect(pesanPelunasanGagal({ message: "fetch failed" })).toMatch(/belum dapat dipastikan/);
  });
});
