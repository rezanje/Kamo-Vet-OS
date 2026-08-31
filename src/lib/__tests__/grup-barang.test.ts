import { describe, expect, it } from "vitest";
import {
  agregasiKebutuhanGrup,
  normalisasiKomponenGrup,
  parseKomponenGrupDrafts,
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

describe("payload form komponen Grup", () => {
  it("menolak JSON rusak", () => {
    expect(parseKomponenGrupDrafts("{"))
      .toEqual({ rows: [], error: "Rincian Grup tidak valid" });
  });

  it("memakai faktor resmi master, bukan faktor dari browser", () => {
    const parsed = parseKomponenGrupDrafts(JSON.stringify([
      { component_item_id: "food", qty: "2", unit: " DUS ", factor: 1 },
    ]));
    expect(parsed.error).toBeNull();

    expect(normalisasiKomponenGrup(parsed.rows, new Map([
      ["food", {
        item_type: "Persediaan" as const,
        is_active: true,
        units: [{ unit: "PCS", factor: 1 }, { unit: "DUS", factor: 12 }],
      }],
    ]))).toEqual({
      rows: [{ component_item_id: "food", qty: 2, unit: "DUS", factor: 12 }],
      error: null,
    });
  });

  it("menolak komponen nonaktif dan satuan yang tidak ada di master", () => {
    const row = component();
    expect(normalisasiKomponenGrup([row], new Map([
      ["food", { item_type: "Persediaan", is_active: false, units: [{ unit: "PCS", factor: 1 }] }],
    ])).error).toBe("Komponen sudah nonaktif atau tidak ditemukan");

    expect(normalisasiKomponenGrup([component({ unit: "KARUNG" })], new Map([
      ["food", { item_type: "Persediaan", is_active: true, units: [{ unit: "PCS", factor: 1 }] }],
    ])).error).toBe('Satuan "KARUNG" tidak terdaftar untuk komponen');
  });
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
