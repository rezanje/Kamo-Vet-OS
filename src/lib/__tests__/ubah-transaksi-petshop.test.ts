import { describe, expect, it } from "vitest";
import { alasanUbahTransaksiTerhalang, bulanJakarta } from "@/lib/ubah-transaksi-petshop";

describe("peringatan ubah transaksi petshop sebelum batalkan penerimaan", () => {
  it("struk biasa: tidak ada peringatan", () => {
    expect(alasanUbahTransaksiTerhalang({ voucherCode: null, promoItemCount: 0, payrollMonthExists: false })).toEqual([]);
    expect(alasanUbahTransaksiTerhalang({ voucherCode: "  ", promoItemCount: 0, payrollMonthExists: false })).toEqual([]);
  });
  it("voucher, promo, penggajian: tiap penyebab disebut sendiri", () => {
    expect(alasanUbahTransaksiTerhalang({ voucherCode: "HEMAT10", promoItemCount: 0, payrollMonthExists: false })).toEqual(["struk ini memakai voucher"]);
    expect(alasanUbahTransaksiTerhalang({ voucherCode: null, promoItemCount: 2, payrollMonthExists: false })).toEqual(["struk ini berisi item promo"]);
    expect(alasanUbahTransaksiTerhalang({ voucherCode: null, promoItemCount: 0, payrollMonthExists: true })).toEqual(["penggajian bulan struk ini sudah dibuat"]);
    expect(alasanUbahTransaksiTerhalang({ voucherCode: "X", promoItemCount: 1, payrollMonthExists: true })).toHaveLength(3);
  });
  it("bulan memakai zona Asia/Jakarta (UTC 31 Okt 20:00 = 1 Nov WIB)", () => {
    expect(bulanJakarta("2026-10-31T20:00:00Z")).toBe("2026-11");
    expect(bulanJakarta("2026-10-31T16:59:00Z")).toBe("2026-10");
  });
});
