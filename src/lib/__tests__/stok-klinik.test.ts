import { describe, expect, it } from "vitest";
import { keadaanStok, petaStokKlinik, stokGudangKlinik, teksStok } from "../stok-klinik";
import { kekuranganStok } from "../stok-keranjang";

// Paket B: stok di layar klinik = stok gudang klinik TRANSAKSI (gudang VET cabang kunjungan),
// dalam satuan yang dipilih di baris, dan "belum terbaca" tidak pernah tampil sebagai nol.
describe("stokGudangKlinik — stok gudang transaksi, bukan tebakan", () => {
  const stock = new Map([["obat", 25]]);
  it("gudang klinik cabang belum terbaca → null (belum terbaca), bukan 0", () => {
    expect(stokGudangKlinik({ stock, warehouseId: null }, "obat")).toBeNull();
    expect(stokGudangKlinik({ stock: new Map(), warehouseId: null }, "lain")).toBeNull();
  });
  it("gudang terbaca: baris stok dipakai, tanpa baris stok berarti benar-benar 0", () => {
    expect(stokGudangKlinik({ stock, warehouseId: "wh-vet-a" }, "obat")).toBe(25);
    expect(stokGudangKlinik({ stock, warehouseId: "wh-vet-a" }, "kosong")).toBe(0);
  });
});

describe("keadaanStok / teksStok — satuan jual dengan faktor yang benar", () => {
  it("belum terbaca ditulis 'belum terbaca', bukan angka nol", () => {
    const k = keadaanStok({ stok: null, satuanDasar: "pcs" });
    expect(k.status).toBe("belum-terbaca");
    expect(k.tersedia).toBeNull();
    expect(teksStok(k)).toBe("stok belum terbaca");
    expect(teksStok(k)).not.toMatch(/\b0\b/);
  });
  it("nol yang terbaca tetap nol dan ditandai habis", () => {
    const k = keadaanStok({ stok: 0, satuanDasar: "pcs" });
    expect(k.status).toBe("habis");
    expect(teksStok(k)).toBe("stok 0 pcs");
  });
  it("stok satuan dasar dikonversi ke satuan jual (box isi 10)", () => {
    const k = keadaanStok({ stok: 25, satuanDasar: "pcs", satuan: "box", faktor: 10 });
    expect(k.tersedia).toBe(2.5);
    expect(k.satuan).toBe("box");
    expect(teksStok(k)).toBe("stok 2,5 box (25 pcs)");
  });
  it("tidak pernah memakai angka satuan dasar sebagai satuan jual bila faktornya tidak diketahui", () => {
    const k = keadaanStok({ stok: 25, satuanDasar: "pcs", satuan: "box", faktor: null });
    expect(k.status).toBe("tanpa-konversi");
    expect(k.tersedia).toBeNull();
    expect(teksStok(k)).toBe("stok 25 pcs (faktor box belum ada)");
    expect(teksStok(k)).not.toMatch(/25 box/);
  });
  it("kekurangan ditampilkan dalam satuan baris", () => {
    const k = keadaanStok({ stok: 25, satuanDasar: "pcs", satuan: "box", faktor: 10, butuh: 3 });
    expect(k.status).toBe("kurang");
    expect(teksStok(k)).toBe("stok 2,5 box (25 pcs) · kurang 0,5 box");
  });
  it("cukup bila kebutuhan ≤ stok", () => {
    expect(keadaanStok({ stok: 25, satuanDasar: "pcs", butuh: 25 }).status).toBe("cukup");
  });
  it("kebutuhan tanpa stok terbaca tetap 'belum terbaca', bukan 'kurang'", () => {
    const k = keadaanStok({ stok: null, satuanDasar: "pcs", butuh: 3 });
    expect(k.status).toBe("belum-terbaca");
  });
});

describe("petaStokKlinik — satu peta untuk tampilan dan pemeriksaan keranjang", () => {
  it("jasa tidak punya stok; barang persediaan termasuk tindakan persediaan ikut dipetakan", () => {
    const peta = petaStokKlinik(
      [{ id: "obat", stok: 5, unit: "pcs", item_type: "Persediaan", units: [{ unit: "pcs", factor: 1 }, { unit: "box", factor: 10 }] }],
      [{ id: "konsul", stok: 0, unit: "kali", item_type: "Jasa" }],
      [{ id: "tindakan", stok: null, unit: "pcs", item_type: "Persediaan" }],
    );
    expect(peta.has("konsul")).toBe(false);
    expect(peta.get("obat")).toMatchObject({ stok: 5, unit: "pcs" });
    expect(peta.get("tindakan")).toMatchObject({ stok: null });
  });
});

describe("kekuranganStok — stok belum terbaca tidak dianggap nol, penjagaan tidak dilonggarkan", () => {
  it("baris dengan stok belum terbaca tetap ditahan, dengan tersedia tidak diketahui (bukan 0)", () => {
    const peta = new Map<string, { stok: number | null; unit: string }>([["a", { stok: null, unit: "pcs" }], ["b", { stok: 1, unit: "pcs" }], ["c", { stok: 9, unit: "pcs" }]]);
    expect(kekuranganStok([
      { item_id: "a", nama_obat: "Obat A", qty: 3, faktor: 1, jenis: "obat" },
      { item_id: "b", nama_obat: "Obat B", qty: 2, faktor: 1, jenis: "obat" },
      { item_id: "c", nama_obat: "Obat C", qty: 2, faktor: 1, jenis: "obat" },
    ], peta)).toEqual([
      { kunci: "a", item_id: "a", nama: "Obat A", butuh: 3, tersedia: null, satuan: "pcs" },
      { kunci: "b", item_id: "b", nama: "Obat B", butuh: 2, tersedia: 1, satuan: "pcs" },
    ]);
  });
});
