import { describe, expect, it } from "vitest";
import { kalimatNilaiOpname, nilaiDariKuitansi, nilaiDariLaporanHarga } from "../opname-nilai";

const receipt = (over: Record<string, unknown> = {}) => ({ shortage_value: 500, surplus_value: 300, surplus_offset: 300, net_variance: 200, surplus_unpriced: [], ...over });

describe("nilaiDariKuitansi", () => {
  it("kurang 500, lebih 300 -> neto kurang 200", () => {
    expect(nilaiDariKuitansi(receipt())).toEqual({ kurang: "500.00", lebih: "300.00", neto: "200.00", arah: "kurang", tanpaHarga: [] });
  });
  it("lebih > kurang -> neto lebih", () => {
    expect(nilaiDariKuitansi(receipt({ shortage_value: "500.00", surplus_value: "700.00" }))).toMatchObject({ neto: "200.00", arah: "lebih" });
  });
  it("sama -> nol", () => { expect(nilaiDariKuitansi(receipt({ shortage_value: 5, surplus_value: 5 }))?.arah).toBe("nol"); });
  it("kuitansi lama tanpa kunci baru, nilai rusak, atau negatif -> null (tidak mengarang angka)", () => {
    expect(nilaiDariKuitansi({ result_id: "x" })).toBeNull();
    expect(nilaiDariKuitansi(null)).toBeNull();
    expect(nilaiDariKuitansi(receipt({ shortage_value: "abc" }))).toBeNull();
    expect(nilaiDariKuitansi(receipt({ surplus_value: -1 }))).toBeNull();
  });
  it("membawa daftar barang tanpa harga", () => {
    expect(nilaiDariKuitansi(receipt({ surplus_unpriced: [{ item_id: "i", name: "Barang A", qty: 2 }, { bukan: "baris" }, null] }))?.tanpaHarga).toEqual([{ name: "Barang A", qty: "2" }]);
  });
});

describe("nilaiDariLaporanHarga", () => {
  it("menjumlahkan baris lebih dan baris kurang dari foto laporan harga", () => {
    const n = nilaiDariLaporanHarga({ rows: [{ selisih: 3, nilai_selisih_modal: "300", name: "A" }, { selisih: -5, nilai_selisih_modal: "-500", name: "B" }, { selisih: 0, nilai_selisih_modal: "0", name: "C" }] });
    expect(n).toMatchObject({ kurang: "500.00", lebih: "300.00", neto: "200.00", arah: "kurang" });
  });
  it("baris lebih bernilai 0 (data lama) ditandai tanpa harga", () => {
    expect(nilaiDariLaporanHarga({ rows: [{ selisih: 17, nilai_selisih_modal: "0", name: "ANC Can Adult 400g" }] })?.tanpaHarga).toEqual([{ name: "ANC Can Adult 400g", qty: "17" }]);
  });
  it("bentuk tidak dikenal atau baris rusak -> null", () => {
    expect(nilaiDariLaporanHarga({})).toBeNull();
    expect(nilaiDariLaporanHarga(null)).toBeNull();
    expect(nilaiDariLaporanHarga({ rows: [{ selisih: 1 }] })).toBeNull();
  });
});

describe("kalimatNilaiOpname", () => {
  const n = nilaiDariKuitansi(receipt())!;
  it("kantor: kurang, lebih, neto dengan akun", () => {
    const s = kalimatNilaiOpname(n, true);
    expect(s).toContain("kurang Rp 500"); expect(s).toContain("lebih Rp 300"); expect(s).toContain("neto kurang Rp 200"); expect(s).toContain("Beban Selisih Stok"); expect(s).toContain("HPP rata-rata");
  });
  it("neto lebih menyebut Pendapatan Lain-lain", () => {
    expect(kalimatNilaiOpname(nilaiDariKuitansi(receipt({ surplus_value: 700 }))!, true)).toContain("neto lebih Rp 200 (Pendapatan Lain-lain)");
  });
  it("kasir: tanpa angka modal sama sekali", () => {
    const s = kalimatNilaiOpname(n, false);
    expect(s).toBe(""); expect(/Rp/.test(s)).toBe(false);
  });
  it("peringatan barang tanpa harga tampil juga untuk kasir, tanpa Rp selain 'Rp 0'", () => {
    const u = nilaiDariKuitansi(receipt({ surplus_unpriced: [{ name: "Z", qty: 2 }] }))!;
    const s = kalimatNilaiOpname(u, false);
    expect(s).toContain("1 barang"); expect(s).toContain("(Z)"); expect(s.replace(/Rp 0/g, "")).not.toMatch(/Rp \d/);
  });
  it("lebih dari 5 barang tanpa harga diringkas", () => {
    const list = Array.from({ length: 7 }, (_, i) => ({ name: `B${i}`, qty: 1 }));
    expect(kalimatNilaiOpname(nilaiDariKuitansi(receipt({ surplus_unpriced: list }))!, false)).toContain("dan 2 lainnya");
  });
  it("tanpa selisih dan tanpa peringatan -> kosong; null -> kosong", () => {
    expect(kalimatNilaiOpname(nilaiDariKuitansi(receipt({ shortage_value: 0, surplus_value: 0 }))!, true)).toBe("");
    expect(kalimatNilaiOpname(null, true)).toBe("");
  });
});
