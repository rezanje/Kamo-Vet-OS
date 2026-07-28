import { describe, it, expect } from "vitest";
import { buildTree, labelPath, validateParent, flatOptions, type KategoriRow } from "./kategori";

const rows: KategoriRow[] = [
  { id: "mkn", name: "Makanan", parent_id: null, is_active: true },
  { id: "kucing", name: "Makanan Kucing", parent_id: "mkn", is_active: true },
  { id: "anjing", name: "Makanan Anjing", parent_id: "mkn", is_active: true },
  { id: "obat", name: "Obat", parent_id: null, is_active: true },
];

describe("buildTree", () => {
  it("induk urut abjad, anak nempel ke induknya", () => {
    const tree = buildTree(rows);
    expect(tree.map((t) => t.induk.id)).toEqual(["mkn", "obat"]);
    expect(tree[0].anak.map((a) => a.name)).toEqual(["Makanan Anjing", "Makanan Kucing"]);
    expect(tree[1].anak).toEqual([]);
  });

  it("anak yang induknya sudah hilang tetap tampil sebagai induk, tidak menghilang", () => {
    const yatim: KategoriRow[] = [{ id: "x", name: "Yatim", parent_id: "tidak-ada", is_active: true }];
    expect(buildTree(yatim).map((t) => t.induk.id)).toEqual(["x"]);
  });
});

describe("labelPath", () => {
  it("anak ditulis lengkap dengan induknya", () => {
    expect(labelPath("kucing", rows)).toBe("Makanan › Makanan Kucing");
    expect(labelPath("obat", rows)).toBe("Obat");
  });

  it("id tidak dikenal jadi string kosong", () => {
    expect(labelPath("hantu", rows)).toBe("");
  });
});

describe("validateParent", () => {
  it("tingkat ketiga ditolak", () => {
    expect(validateParent("obat", "kucing", rows)).toMatch(/dua tingkat/i);
  });

  it("kategori yang sudah punya anak tidak boleh dijadikan anak orang lain", () => {
    expect(validateParent("mkn", "obat", rows)).toMatch(/sudah punya anak/i);
  });

  it("kategori tidak boleh jadi induk dirinya sendiri", () => {
    expect(validateParent("mkn", "mkn", rows)).toMatch(/dirinya sendiri/i);
  });

  it("anak baru di bawah induk yang sah lolos", () => {
    expect(validateParent("obat", "mkn", rows)).toBeNull();
  });

  it("tanpa induk (jadi induk sendiri) selalu lolos", () => {
    expect(validateParent("kucing", null, rows)).toBeNull();
    expect(validateParent("", null, rows)).toBeNull();
  });

  it("induk yang tidak ada di daftar ditolak", () => {
    expect(validateParent("obat", "hantu", rows)).toMatch(/tidak ditemukan/i);
  });
});

describe("flatOptions", () => {
  it("urut pohon, anak berlabel lengkap", () => {
    expect(flatOptions(rows).map((o) => o.label)).toEqual([
      "Makanan",
      "Makanan › Makanan Anjing",
      "Makanan › Makanan Kucing",
      "Obat",
    ]);
  });

  it("kategori nonaktif dibuang beserta anaknya", () => {
    const mati = rows.map((r) => (r.id === "mkn" ? { ...r, is_active: false } : r));
    expect(flatOptions(mati).map((o) => o.id)).toEqual(["obat"]);
  });
});
