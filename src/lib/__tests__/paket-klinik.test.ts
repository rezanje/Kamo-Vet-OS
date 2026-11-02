import { describe, expect, it } from "vitest";
import { bagiHargaPaket, isiDitagihPerPaket, kenaliPaket, pecahPaket, stokPaket, type ResepPaket } from "../paket-klinik";

const resep: ResepPaket = {
  id: "paket-vaksin", name: "Paket Vaksin F4",
  komponen: [
    { item_id: "jasa-vaksin", name: "Jasa Vaksinasi", item_type: "Jasa", base_unit: "x", qty: 1, unit: "x", factor: 1, tindakan_kategori: "Vaksin" },
    { item_id: "vial-f4", name: "Vaksin F4", item_type: "Persediaan", base_unit: "vial", qty: 1, unit: "vial", factor: 1 },
    { item_id: "spuit", name: "Spuit 1cc", item_type: "Persediaan", base_unit: "pcs", qty: 2, unit: "pcs", factor: 1 },
    { item_id: "kartu", name: "Kartu vaksin", item_type: "Non-Persediaan", base_unit: "lembar", qty: 1, unit: "lembar", factor: 1 },
  ],
};
const hargaNormal: Record<string, number> = { "jasa-vaksin": 100000, "vial-f4": 150000, spuit: 5000 };
const harga = (id: string) => hargaNormal[id] ?? 0;
const nilai = (rows: { qty: number; harga: number }[]) => rows.reduce((a, r) => a + r.qty * r.harga, 0);

describe("pecahPaket", () => {
  it("memecah paket jadi baris obat dan jasa dengan total = harga paket; Non-Persediaan dilewati", () => {
    const hasil = pecahPaket(resep, 230000, 1, harga);
    expect(hasil.error).toBeNull();
    expect(hasil.baris.map(b => [b.item_id, b.jenis, b.qty, b.satuan])).toEqual([
      ["jasa-vaksin", "jasa", 1, "x"], ["vial-f4", "obat", 1, "vial"], ["spuit", "obat", 2, "pcs"],
    ]);
    expect(nilai(hasil.baris)).toBe(230000);
    expect(hasil.baris[0].kategori).toBe("Vaksin");
    // Sebanding harga normal (100.000 : 150.000 : 10.000).
    expect(hasil.baris[1].harga).toBeGreaterThan(hasil.baris[0].harga);
  });

  it("jumlah paket mengalikan qty, harga per satuan tetap", () => {
    const satu = pecahPaket(resep, 230000, 1, harga);
    const tiga = pecahPaket(resep, 230000, 3, harga);
    expect(tiga.baris.map(b => b.qty)).toEqual([3, 3, 6]);
    expect(tiga.baris.map(b => b.harga)).toEqual(satu.baris.map(b => b.harga));
    expect(nilai(tiga.baris)).toBe(690000);
  });

  it("isi pecahan (0,5 strip) ditagih dalam satuan dasar; satuan dasar saja bila diminta", () => {
    const strip: ResepPaket = { id: "p", name: "P", komponen: [
      { item_id: "obat", name: "Obat", item_type: "Persediaan", base_unit: "tab", qty: 0.5, unit: "strip", factor: 10 },
      { item_id: "box", name: "Box", item_type: "Persediaan", base_unit: "pcs", qty: 1, unit: "box", factor: 12 },
    ] };
    const hasil = pecahPaket(strip, 50000, 1, () => 1000);
    expect(hasil.baris.map(b => [b.qty, b.satuan, b.faktor])).toEqual([[5, "tab", 1], [1, "box", 12]]);
    const dasar = pecahPaket(strip, 50000, 1, () => 1000, { satuanDasarSaja: true });
    expect(dasar.baris.map(b => [b.qty, b.satuan, b.faktor])).toEqual([[5, "tab", 1], [12, "pcs", 1]]);
    expect(nilai(dasar.baris)).toBe(50000);
  });

  it("menolak isi yang tidak bulat bahkan dalam satuan dasar, dan paket tanpa isi yang bisa ditagih", () => {
    const pecahan: ResepPaket = { id: "p", name: "P", komponen: [
      { item_id: "x", name: "Cairan", item_type: "Persediaan", base_unit: "ml", qty: 0.25, unit: "ml", factor: 1 }] };
    expect(pecahPaket(pecahan, 1000, 1, () => 0).error).toContain("bukan bilangan bulat");
    const kosong: ResepPaket = { id: "p", name: "P", komponen: [resep.komponen[3]] };
    expect(pecahPaket(kosong, 1000, 1, () => 0).error).toContain("tidak berisi");
  });

  it("menggabungkan barang yang muncul dua kali di resep (beda satuan) ke satuan dasar", () => {
    const dobel: ResepPaket = { id: "p", name: "P", komponen: [
      { item_id: "a", name: "A", item_type: "Persediaan", base_unit: "pcs", qty: 1, unit: "box", factor: 10 },
      { item_id: "a", name: "A", item_type: "Persediaan", base_unit: "pcs", qty: 2, unit: "pcs", factor: 1 },
    ] };
    const hasil = pecahPaket(dobel, 12000, 1, () => 0);
    expect(hasil.baris).toHaveLength(1);
    expect(hasil.baris[0]).toMatchObject({ qty: 12, satuan: "pcs", faktor: 1, harga: 1000 });
  });
});

describe("bagiHargaPaket", () => {
  it("total selalu tepat bila ada baris qty 1", () => {
    const harga = bagiHargaPaket(100001, [{ qty: 3, bobot: 1 }, { qty: 1, bobot: 1 }, { qty: 7, bobot: 5 }]);
    expect(Math.round((harga[0] * 3 + harga[1] + harga[2] * 7) * 100)).toBe(10000100);
  });
  it("bobot nol semua → dibagi menurut qty", () => {
    expect(bagiHargaPaket(30000, [{ qty: 1, bobot: 0 }, { qty: 2, bobot: 0 }])).toEqual([10000, 10000]);
  });
});

describe("stokPaket", () => {
  it("berapa paket yang bisa dibuat dari stok isi persediaan; null bila stok belum terbaca", () => {
    expect(stokPaket(resep, id => ({ "vial-f4": 4, spuit: 5 } as Record<string, number>)[id] ?? 0)).toBe(2);
    expect(stokPaket(resep, id => id === "spuit" ? null : 10)).toBeNull();
  });
});

describe("kenaliPaket", () => {
  const paket = [{ id: resep.id, harga: 230000, perPaket: isiDitagihPerPaket(resep) }];
  const faktor = () => 1;
  type Baris = { item_id: string; qty: number; harga: number; satuan: string; package_item_id?: string | null; package_qty?: number | null };
  it("menandai baris rekam medis yang persis isi paket (qty & total harga)", () => {
    const baris = pecahPaket(resep, 230000, 2, harga).baris.map((b): Baris => ({ item_id: b.item_id, qty: b.qty, harga: b.harga, satuan: b.satuan }));
    const lain: Baris = { item_id: "spuit", qty: 1, harga: 5000, satuan: "pcs" };
    const out = kenaliPaket([...baris, lain], paket, faktor);
    expect(out.slice(0, 3).map(r => [r.package_item_id, r.package_qty])).toEqual([[resep.id, 2], [resep.id, 2], [resep.id, 2]]);
    expect(out[3].package_item_id).toBeUndefined();
  });
  it("tidak menandai bila harga atau qty tidak cocok", () => {
    const baris = pecahPaket(resep, 230000, 1, harga).baris.map((b): Baris => ({ item_id: b.item_id, qty: b.qty, harga: b.harga, satuan: b.satuan }));
    expect(kenaliPaket(baris.map((b, i) => i === 1 ? { ...b, harga: b.harga + 1000 } : b), paket, faktor).some(r => r.package_item_id)).toBe(false);
    expect(kenaliPaket(baris.map((b, i) => i === 2 ? { ...b, qty: 3 } : b), paket, faktor).some(r => r.package_item_id)).toBe(false);
  });
});
