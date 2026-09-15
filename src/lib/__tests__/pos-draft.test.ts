import { describe, expect, it } from "vitest";
import { bacaDraftKasir, bacaDraftPos, type KasirDraft, type PosDraft } from "../pos-draft";

const draft: PosDraft = {
  version: 1,
  savedAt: 1_000,
  branchId: "cabang-1",
  customerId: "pelanggan-1",
  petId: "hewan-1",
  salespersonId: "pegawai-1",
  metode: "Tunai",
  discount: 5_000,
  bayar: 100_000,
  cart: [{ item_id: "barang-1", nama: "Pakan", qty: 2, harga: 25_000, target_species: "Kucing", satuan: "pcs", faktor: 1 }],
};

describe("bacaDraftPos", () => {
  it("mengembalikan transaksi gagal yang masih layak diedit", () => {
    expect(bacaDraftPos(JSON.stringify(draft), 2_000)).toEqual(draft);
  });

  it("mengabaikan data rusak atau draft lama", () => {
    expect(bacaDraftPos("bukan-json", 2_000)).toBeNull();
    expect(bacaDraftPos(JSON.stringify(draft), 1_000 + 25 * 60 * 60 * 1_000)).toBeNull();
  });
});

const kasirDraft: KasirDraft = {
  version: 1,
  savedAt: 1_000,
  customerId: "pelanggan-1",
  salespersonId: "pegawai-1",
  metode: "QRIS",
  diskon: 10,
  diskonPct: true,
  poin: 50,
  voucher: "HEMAT10",
  bayar: 0,
  cart: [{ item_id: "barang-1", nama: "Pakan", qty: 2, harga: 25_000, satuan: "pcs", faktor: 1 }],
};

describe("bacaDraftKasir", () => {
  it("mengembalikan transaksi kasir gagal lengkap dengan tenaga penjual", () => {
    expect(bacaDraftKasir(JSON.stringify(kasirDraft), 2_000)).toEqual(kasirDraft);
  });

  it("mengabaikan draft kosong dan kadaluarsa", () => {
    expect(bacaDraftKasir(JSON.stringify({ ...kasirDraft, cart: [] }), 2_000)).toBeNull();
    expect(bacaDraftKasir(JSON.stringify(kasirDraft), 1_000 + 25 * 60 * 60 * 1_000)).toBeNull();
  });
});
