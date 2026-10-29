import { describe, expect, it } from "vitest";
import { fakturGrosirOmzet, hppBarisGrosir, nilaiBarisGrosir, omzetDokumenGrosir } from "../laporan-grosir";

const faktur = (over: Partial<Parameters<typeof fakturGrosirOmzet>[0][number]> & { id: string }) => ({
  status: "berjalan", kategori: "umum", voided_on: null, opening_batch_id: null, replaces_invoice_id: null,
  ...over,
});

describe("fakturGrosirOmzet", () => {
  it("menghitung faktur berjalan yang belum dibayar sebagai omzet (akrual)", () => {
    expect(fakturGrosirOmzet([faktur({ id: "a", status: "berjalan" }), faktur({ id: "b", status: "lunas" })])
      .map(row => row.id)).toEqual(["a", "b"]);
  });

  it("membuang faktur batal dan faktur yang di-void", () => {
    expect(fakturGrosirOmzet([
      faktur({ id: "hidup" }),
      faktur({ id: "batal", status: "batal" }),
      faktur({ id: "void", voided_on: "2026-10-29" }),
      faktur({ id: "Batal-Besar", status: " BATAL " }),
    ]).map(row => row.id)).toEqual(["hidup"]);
  });

  it("hanya menghitung faktur pengganti ketika satu baris dikoreksi, bukan dua-duanya", () => {
    const lama = faktur({ id: "lama", status: "batal", voided_on: "2026-10-29" });
    const pengganti = faktur({ id: "pengganti", replaces_invoice_id: "lama" });
    expect(fakturGrosirOmzet([lama, pengganti]).map(row => row.id)).toEqual(["pengganti"]);
  });

  it("tetap membuang faktur yang sudah punya pengganti walau statusnya belum ikut berubah", () => {
    expect(fakturGrosirOmzet([
      faktur({ id: "lama" }),
      faktur({ id: "pengganti", replaces_invoice_id: "lama" }),
    ]).map(row => row.id)).toEqual(["pengganti"]);
  });

  it("membuang faktur saldo awal dan faktur selisih stok opname", () => {
    expect(fakturGrosirOmzet([
      faktur({ id: "jual" }),
      faktur({ id: "saldo-awal", opening_batch_id: "batch" }),
      faktur({ id: "opname", kategori: "selisih_stok" }),
      faktur({ id: "tanpa-kategori", kategori: null }),
    ]).map(row => row.id)).toEqual(["jual", "tanpa-kategori"]);
  });
});

describe("nilai faktur grosir", () => {
  it("memakai total dokumen untuk omzet per dokumen, termasuk PPN seperti dokumen lain", () => {
    expect(omzetDokumenGrosir({ total: "1050000.00" })).toBe(1_050_000);
    expect(omzetDokumenGrosir({ total: null })).toBe(0);
  });

  it("memakai qty x harga dikurangi diskon baris sebagai nilai baris (dasar DPP sebelum PPN)", () => {
    expect(nilaiBarisGrosir({ qty: 3, harga: 350_000, diskon: 0 })).toBe(1_050_000);
    expect(nilaiBarisGrosir({ qty: "2", harga: "15000.00", diskon: "2500.00" })).toBe(27_500);
    expect(nilaiBarisGrosir({ qty: 1, harga: 14_000, diskon: null })).toBe(14_000);
  });

  it("mengosongkan HPP baris yang modalnya belum datang dari pengiriman", () => {
    expect(hppBarisGrosir({ hpp: "724000.00" })).toBe(724_000);
    expect(hppBarisGrosir({ hpp: 0 })).toBeNull();
    expect(hppBarisGrosir({ hpp: null })).toBeNull();
  });
});
