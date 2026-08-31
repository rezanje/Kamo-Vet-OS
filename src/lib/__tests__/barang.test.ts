import { describe, it, expect } from "vitest";
import {
  fieldBarangMenurutJenis,
  ITEM_TYPES,
  pickItemType,
  validasiBarang,
  pesanSimpanGagal,
  type BarangDraft,
} from "../barang";

const draft = (over: Partial<BarangDraft> = {}): BarangDraft => ({
  name: "ANC Cat Litter 5,5L",
  code: "100511",
  categoryId: "kat-1",
  itemType: "Persediaan",
  sellPrice: 65000,
  buyPrice: 50000,
  minStock: 0,
  tindakanKategori: "",
  ...over,
});

describe("pickItemType", () => {
  it("jenis karangan jatuh ke Persediaan, bukan diteruskan apa adanya", () => {
    expect(pickItemType("Bebas")).toBe("Persediaan");
    expect(pickItemType(null)).toBe("Persediaan");
  });

  it("jenis resmi diterima", () => {
    expect(pickItemType("Jasa")).toBe("Jasa");
    expect(pickItemType("Non-Persediaan")).toBe("Non-Persediaan");
  });

  it("Grup resmi tetapi tidak punya stok atau pembelian sendiri", () => {
    expect(ITEM_TYPES).toContain("Grup");
    expect(pickItemType("Grup")).toBe("Grup");
    expect(fieldBarangMenurutJenis("Grup")).toEqual({ punyaStok: false, bolehDibeli: false });
  });
});

describe("validasiBarang", () => {
  it("barang lengkap lolos", () => {
    expect(validasiBarang(draft())).toBeNull();
  });

  it("kode kosong ditolak dgn pesan Indonesia (dulu bocor jadi error Postgres)", () => {
    expect(validasiBarang(draft({ code: "  " }))).toBe("Kode barang wajib diisi");
  });

  it("nama & kategori kosong ditolak", () => {
    expect(validasiBarang(draft({ name: "" }))).toBe("Nama barang wajib diisi");
    expect(validasiBarang(draft({ categoryId: "" }))).toBe("Kategori barang wajib dipilih");
  });

  it("harga & stok minimum negatif atau bukan angka ditolak", () => {
    expect(validasiBarang(draft({ sellPrice: -1 }))).toBe("Harga jual tidak valid");
    expect(validasiBarang(draft({ buyPrice: Number.NaN }))).toBe("Harga beli tidak valid");
    expect(validasiBarang(draft({ minStock: -5 }))).toBe("Stok minimum tidak valid");
  });

  it("jasa wajib kategori tindakan, dan tindakan karangan ditolak", () => {
    expect(validasiBarang(draft({ itemType: "Jasa" }))).toBe("Jasa wajib punya kategori tindakan");
    expect(validasiBarang(draft({ itemType: "Jasa", tindakanKategori: "Ngobrol" })))
      .toBe("Jasa wajib punya kategori tindakan");
    expect(validasiBarang(draft({ itemType: "Jasa", tindakanKategori: "Konsultasi" }))).toBeNull();
  });

  it("barang non-jasa tidak dipaksa punya kategori tindakan", () => {
    expect(validasiBarang(draft({ itemType: "Non-Persediaan" }))).toBeNull();
  });
});

describe("pesanSimpanGagal", () => {
  it("kode dobel dijelaskan, bukan ditampilkan mentah", () => {
    expect(pesanSimpanGagal('duplicate key value violates unique constraint "items_code_key"'))
      .toBe("Kode barang itu sudah dipakai barang lain");
  });

  it("merek dobel dijelaskan", () => {
    expect(pesanSimpanGagal('duplicate key value violates unique constraint "brands_name_key"'))
      .toBe("Merek dengan nama itu sudah ada");
  });

  it("error tak dikenal diteruskan apa adanya", () => {
    expect(pesanSimpanGagal("connection reset")).toBe("connection reset");
  });
});
