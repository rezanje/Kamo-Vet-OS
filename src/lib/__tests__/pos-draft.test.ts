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
  it("retains the posting identity of a pending backoffice checkout", () => {
    const saved = { ...draft, checkoutKey: "posting-identity" };
    expect(bacaDraftPos(JSON.stringify(saved), 2_000)).toEqual(saved);
  });

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

describe("pending mixed POS payment drafts", () => {
  const payments = [{ method: "Tunai", amount: 20_000 }, { method: "Transfer", amount: 0 }];

  it("keeps cashier allocations still being edited and the cash actually received", () => {
    const saved = { ...kasirDraft, split: true, payments, bayar: 50_000 };
    expect(bacaDraftKasir(JSON.stringify(saved), 2_000)).toEqual(saved);
  });

  it("keeps backoffice allocations still being edited and the cash actually received", () => {
    const saved = { ...draft, split: true, payments, bayar: 50_000 };
    expect(bacaDraftPos(JSON.stringify(saved), 2_000)).toEqual(saved);
  });

  it("removes unusable payment rows from browser drafts while retaining editable amounts", () => {
    const saved = { ...kasirDraft, split: true, payments: [null, ...payments, { method: "Other", amount: 5 }, { method: "Tunai", amount: 10 }, { method: "QRIS", amount: -1 }] };
    expect(bacaDraftKasir(JSON.stringify(saved), 2_000)).toMatchObject({ split: true, payments });
  });
});
