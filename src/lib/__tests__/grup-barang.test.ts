import { describe, expect, it } from "vitest";
import {
  agregasiKebutuhanGrup,
  stokEfektifGrup,
  validasiKomponenGrup,
  type KomponenGrupDraft,
} from "../grup-barang";

const persediaan = new Map([
  ["food", "Persediaan" as const],
  ["service", "Jasa" as const],
  ["bundle", "Grup" as const],
]);

const component = (patch: Partial<KomponenGrupDraft> = {}): KomponenGrupDraft => ({
  component_item_id: "food",
  qty: 1,
  unit: "PCS",
  factor: 1,
  ...patch,
});

describe("validasiKomponenGrup", () => {
  it("menolak grup tanpa komponen", () => {
    expect(validasiKomponenGrup([], persediaan)).toBe("Grup wajib punya minimal 1 komponen");
  });

  it("menolak qty dan faktor yang tidak positif", () => {
    expect(validasiKomponenGrup([component({ qty: 0 })], persediaan))
      .toBe("Qty komponen harus lebih dari 0");
    expect(validasiKomponenGrup([component({ factor: Number.NaN })], persediaan))
      .toBe("Faktor satuan harus lebih dari 0");
  });

  it("menolak komponen bertipe Grup", () => {
    expect(validasiKomponenGrup([component({ component_item_id: "bundle" })], persediaan))
      .toBe("Komponen tidak boleh Grup");
  });

  it("menolak item+satuan kembar tetapi mengizinkan item sama dalam satuan berbeda", () => {
    expect(validasiKomponenGrup([
      component(),
      component({ qty: 2 }),
    ], persediaan)).toBe("Komponen dan satuan kembar tidak diperbolehkan");

    expect(validasiKomponenGrup([
      component(),
      component({ unit: "DUS", factor: 12 }),
    ], persediaan)).toBeNull();
  });
});

describe("agregasiKebutuhanGrup", () => {
  it("menjumlahkan kebutuhan item sama dan melewati jenis tanpa stok", () => {
    expect(agregasiKebutuhanGrup([
      { item_id: "food", qty_dasar: 2, item_type: "Persediaan", source_sale_item: "direct" },
      { item_id: "food", qty_dasar: 6, item_type: "Persediaan", source_sale_item: "group" },
      { item_id: "service", qty_dasar: 1, item_type: "Jasa", source_sale_item: "group" },
      { item_id: "label", qty_dasar: 1, item_type: "Non-Persediaan", source_sale_item: "group" },
    ])).toEqual([{ item_id: "food", qty_dasar: 8 }]);
  });
});

describe("stokEfektifGrup", () => {
  it("mengambil floor stok terkecil komponen Persediaan", () => {
    expect(stokEfektifGrup([
      { item_id: "food", qty_per_group: 2, item_type: "Persediaan" },
      { item_id: "bowl", qty_per_group: 3, item_type: "Persediaan" },
      { item_id: "service", qty_per_group: 1, item_type: "Jasa" },
    ], new Map([["food", 9], ["bowl", 11]]))).toBe(3);
  });

  it("grup tanpa komponen Persediaan tidak dibatasi stok", () => {
    expect(stokEfektifGrup([
      { item_id: "service", qty_per_group: 1, item_type: "Jasa" },
    ], new Map())).toBe(Number.MAX_SAFE_INTEGER);
  });
});
