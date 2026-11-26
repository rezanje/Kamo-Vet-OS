import { describe, expect, it } from "vitest";
import { hrefDokumen, hrefNomorModul, nomorDokumenJurnal, tampakNomorDokumen, tautanSumberJurnal } from "../tautan-dokumen";

describe("tampakNomorDokumen", () => {
  it("mengenali nomor dokumen VetOS", () => {
    for (const no of [
      "FJ.2026.08.00001", "FJS.2026.08.00001", "OPO.00385", "OPR.00362",
      "JRN-202608-0091", "POS-20260814-0003", "RJ.2026.08.00002", "TB.2026.07.00010",
    ]) {
      expect(tampakNomorDokumen(no), no).toBe(true);
    }
  });

  it("keterangan bebas tidak ikut jadi tautan", () => {
    for (const teks of ["bayar listrik", "—", "", "Beban Listrik & Air", "2026-08-17", "12345"]) {
      expect(tampakNomorDokumen(teks), teks).toBe(false);
    }
  });
});

describe("hrefDokumen", () => {
  it("nomor dengan garis miring tetap aman di URL", () => {
    expect(hrefDokumen("FJ/2026/01")).toBe("/dokumen/FJ%2F2026%2F01");
  });
});

it("does not infer a production source from a configurable document prefix", () => {
  expect(hrefNomorModul("PRD.2026.10.00001")).toBeNull();
});

// Laporan Anisa 25 Nov 2026: rincian mutasi akun belum tersambung ke transaksinya
// (pengeluaran kasir toko, struk POS ber-akhiran acak).
describe("tautan dari Buku Besar ke transaksi asal", () => {
  it("struk POS dengan akhiran acak tetap dikenali sebagai nomor", () => {
    for (const no of ["POS-20261101-0001-6L1M", "POS-20261126-0027-ZDP6", "POS-20261125-0001-7851"]) {
      expect(tampakNomorDokumen(no), no).toBe(true);
    }
    expect(tampakNomorDokumen("POS-2026 bayar")).toBe(false);
  });

  it("pengeluaran kasir dan jurnal umum (ref = id) menuju layar koreksinya", () => {
    const id = "8e692432-a8c6-4363-bf23-24c13b73faf6";
    expect(tautanSumberJurnal("expense", id)).toEqual({ href: `/buku-besar/beban/${id}`, label: "Pengeluaran kasir" });
    expect(tautanSumberJurnal("expense-correction", id)?.href).toBe(`/buku-besar/beban/${id}`);
    expect(tautanSumberJurnal("manual", id)?.href).toBe(`/keuangan/jurnal?entry=${id}#journal-${id}`);
    expect(tautanSumberJurnal("shift", id)).toBeNull();
    expect(tautanSumberJurnal("expense", "bukan-id")).toBeNull();
  });

  it("koreksi kas keluar menampilkan nomor KK dari keterangan", () => {
    expect(nomorDokumenJurnal("11c13f49-5a7c-4e02-9f9d-e3bf9d82fc28", "Pembalik kas KK.2026.11.00036")).toBe("KK.2026.11.00036");
  });
});
