import { describe, expect, it } from "vitest";
import { cariKatalogPermintaan, parseBarisInput, siapkanBaris, type KatalogItem, type MasterItem } from "../permintaan";

const pcs = { unit: "pcs", factor: 1, sell_price: 0, buy_price: 0 };
const box = { unit: "box", factor: 12, sell_price: 0, buy_price: 0 };

const master = new Map<string, MasterItem>([
  ["b1", { nama: "Whiskas Tuna", item_type: "Persediaan", units: [pcs, box] }],
  ["j1", { nama: "Grooming Full", item_type: "Jasa", units: [pcs] }],
]);

describe("siapkanBaris", () => {
  it("faktor diambil dari master, bukan dari kiriman klien", () => {
    const { rows, error } = siapkanBaris([{ item_id: "b1", qty_diminta: 2, satuan: "box" }], master);
    expect(error).toBeNull();
    expect(rows[0]).toMatchObject({ satuan: "box", faktor: 12, qty_diminta: 2 });
  });

  it("satuan yang tidak dikenal jatuh ke satuan dasar, bukan faktor karangan", () => {
    const { rows } = siapkanBaris([{ item_id: "b1", qty_diminta: 3, satuan: "peti" }], master);
    expect(rows[0]).toMatchObject({ satuan: "pcs", faktor: 1 });
  });

  it("barang jasa ditolak", () => {
    const { rows, error } = siapkanBaris([{ item_id: "j1", qty_diminta: 1 }], master);
    expect(rows).toHaveLength(0);
    expect(error).toContain("Jasa");
  });

  it("baris kosong / qty 0 diabaikan", () => {
    const { rows, error } = siapkanBaris(
      [{ item_id: "", qty_diminta: 5 }, { item_id: "b1", qty_diminta: 0 }, { item_id: "b1", qty_diminta: 1 }],
      master,
    );
    expect(rows).toHaveLength(1);
    expect(error).toBeNull();
  });

  it("tidak ada baris valid -> error", () => {
    expect(siapkanBaris([], master).error).toBeTruthy();
  });

  it("barang di luar master ditolak", () => {
    expect(siapkanBaris([{ item_id: "xx", qty_diminta: 1 }], master).error).toContain("master");
  });
});

describe("parseBarisInput", () => {
  it("JSON rusak jadi daftar kosong", () => {
    expect(parseBarisInput("{bukan json")).toEqual([]);
    expect(parseBarisInput('{"a":1}')).toEqual([]);
    expect(parseBarisInput('[{"item_id":"b1"}]')).toEqual([{ item_id: "b1" }]);
  });
});

describe("cariKatalogPermintaan", () => {
  const katalog = Array.from({ length: 1_205 }, (_, index): KatalogItem => ({
    id: `id-${index}`,
    code: index === 1_104 ? "ZZ-TARGET" : `SKU-${index}`,
    name: index === 1_104 ? "Vitamin Target Paling Akhir" : `Barang ${index}`,
    unit: "pcs",
    kategori: "Umum",
    units: [pcs],
  }));

  it("menemukan barang di atas urutan 1000 lewat nama atau kode", () => {
    expect(cariKatalogPermintaan(katalog, "target").map((item) => item.id)).toEqual(["id-1104"]);
    expect(cariKatalogPermintaan(katalog, "zz-target").map((item) => item.id)).toEqual(["id-1104"]);
  });

  it("tetap menyertakan barang terpilih saat hasil dibatasi", () => {
    expect(cariKatalogPermintaan(katalog, "", "id-1104", 50).some((item) => item.id === "id-1104")).toBe(true);
  });
});
