import { describe, expect, it } from "vitest";
import { jenisBarisKlinik, kunciRacikan } from "../laporan-penjualan-barang";

describe("klasifikasi baris penjualan klinik", () => {
  const racikan = new Set([kunciRacikan("visit-1", "Puyer Batuk")]);

  it("mengenali racikan hanya dari resep di kunjungan yang sama", () => {
    const baris = { jenis: "obat", item_id: null, deskripsi: " puyer   BATUK " };
    expect(jenisBarisKlinik(baris, "visit-1", racikan)).toBe("Racikan");
    expect(jenisBarisKlinik(baris, "visit-2", racikan)).toBe("Obat");
  });

  it("tidak menganggap obat master atau jasa dengan nama sama sebagai racikan", () => {
    expect(jenisBarisKlinik({ jenis: "obat", item_id: "item-1", deskripsi: "Puyer Batuk" }, "visit-1", racikan)).toBe("Obat");
    expect(jenisBarisKlinik({ jenis: "jasa", item_id: null, deskripsi: "Puyer Batuk" }, "visit-1", racikan)).toBe("Jasa");
  });
});
