import { describe, expect, it } from "vitest";
import { nomorDokumenJurnal } from "../tautan-dokumen";

const UUID = "d828070e-6c9d-4f7f-946b-f86a92b528c7";

describe("nomorDokumenJurnal (kolom Dokumen Buku Besar / Jurnal)", () => {
  it("source_ref UUID (jurnal koreksi metode petshop) -> nomor POS dari keterangan", () => {
    expect(nomorDokumenJurnal(UUID, "Pembalik metode pembayaran POS-20261101-0051-EXGC")).toBe("POS-20261101-0051-EXGC");
    expect(nomorDokumenJurnal(UUID, "Metode pembayaran terkoreksi POS-20261101-0051-EXGC")).toBe("POS-20261101-0051-EXGC");
  });
  it("nomor invoice / kwitansi klinik di keterangan", () => {
    expect(nomorDokumenJurnal(UUID, "Pembatalan penerimaan INV-202611-0899 (KWT-202611-0012)")).toBe("INV-202611-0899");
  });
  it("source_ref yang sudah berupa nomor dokumen tidak diubah", () => {
    expect(nomorDokumenJurnal("POS-20261101-0051-EXGC", "Penjualan POS POS-20261101-0051-EXGC")).toBe("POS-20261101-0051-EXGC");
    expect(nomorDokumenJurnal("bayar listrik", "apa saja")).toBe("bayar listrik");
  });
  it("UUID tanpa nomor di keterangan tetap UUID; kosong tetap kosong; jurnal berulang (uuid:bulan) tidak disentuh", () => {
    expect(nomorDokumenJurnal(UUID, "Penyesuaian kas")).toBe(UUID);
    expect(nomorDokumenJurnal(null, "POS-20261101-0051")).toBe("");
    expect(nomorDokumenJurnal(`${UUID}:2026-11`, "POS-20261101-0051")).toBe(`${UUID}:2026-11`);
  });
});
