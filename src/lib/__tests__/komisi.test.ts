import { describe, it, expect } from "vitest";
import { hitungKomisi, realisasiTarget, type AturanKomisi, type BarisJual, type TargetPenjualan } from "../komisi";

const baris = (o: Partial<BarisJual> = {}): BarisJual => ({
  tanggal: "2026-08-10",
  sumber: "kasir",
  employeeId: "emp1",
  branchId: "cab1",
  itemId: "it1",
  kategoriIds: ["kat-anak", "kat-induk"],
  qty: 1,
  omzet: 100_000,
  laba: 40_000,
  ...o,
});

const aturan = (o: Partial<AturanKomisi> = {}): AturanKomisi => ({
  id: "r1",
  nama: "Komisi",
  tipe: "persen",
  basis: "omzet",
  sumber: "semua",
  persen: 2,
  nominal: 0,
  employeeId: null,
  branchId: null,
  categoryId: null,
  itemId: null,
  minOmzet: 0,
  dari: null,
  sampai: null,
  ...o,
});

const satu = (b: BarisJual[], a: AturanKomisi[]) => hitungKomisi(b, a)[0];

describe("hitungKomisi", () => {
  it("uses configured SKU rates by doctor group and keeps separate sales percent rules", () => {
    // Dummy fixture values exercise different configured rates; no production tariff is seeded.
    const rows = [baris({ employeeId: "doctor-old", qty: 2, omzet: 80_000 }), baris({ employeeId: "doctor-new", qty: 1, omzet: 40_000 })];
    const oldRule = aturan({ id: "old", tipe: "nominal", nominal: 15_000, persen: 0, itemId: "it1", commissionGroup: "doctor_old" });
    const newRule = aturan({ id: "new", tipe: "nominal", nominal: 10_000, persen: 0, itemId: "it1", commissionGroup: "doctor_new" });
    const salesRule = aturan({ id: "sales", employeeId: "doctor-new", persen: 5 });
    const result = hitungKomisi(rows, [oldRule, newRule, salesRule], new Map([
      ["doctor-old", "doctor_old"], ["doctor-new", "doctor_new"],
    ]));
    expect(result.find(r => r.employeeId === "doctor-old")?.komisi).toBe(30_000);
    expect(result.find(r => r.employeeId === "doctor-new")?.komisi).toBe(12_000);
  });

  it("replaces a group rule only for matching individual SKU lines", () => {
    const groupRule = aturan({ id: "group", tipe: "nominal", nominal: 10_000, persen: 0, commissionGroup: "doctor_new" });
    const exception = aturan({ id: "exception", tipe: "nominal", nominal: 15_000, persen: 0, employeeId: "doctor-a", itemId: "it1", overrideGroupRuleId: "group" });
    const rows = [baris({ employeeId: "doctor-a", itemId: "it1" }), baris({ employeeId: "doctor-a", itemId: "it2" })];
    const [result] = hitungKomisi(rows, [groupRule, exception], new Map([["doctor-a", "doctor_new"]]));
    expect(result.komisi).toBe(25_000);
    expect(result.rincian.find(r => r.aturanId === "group")?.dasar).toBe(1);
    expect(result.rincian.find(r => r.aturanId === "exception")?.dasar).toBe(1);
  });

  it("does not apply a group rule when employee has no configured group", () => {
    expect(satu([baris()], [aturan({ commissionGroup: "doctor_old" })]).komisi).toBe(0);
  });

  it("does not pay an individual exception after its group changes or parent is inactive", () => {
    const groupRule = aturan({ id: "group", commissionGroup: "doctor_old" });
    const exception = aturan({ id: "exception", employeeId: "emp1", overrideGroupRuleId: "group", persen: 20 });
    expect(hitungKomisi([baris()], [groupRule, exception], new Map([["emp1", "doctor_new"]]))[0].komisi).toBe(0);
    expect(hitungKomisi([baris()], [exception], new Map([["emp1", "doctor_old"]]))[0].komisi).toBe(0);
  });

  it("limits an individual exception to parent SKU and threshold", () => {
    const groupRule = aturan({ id: "group", commissionGroup: "doctor_old", itemId: "it1", minOmzet: 200_000 });
    const exception = aturan({ id: "exception", employeeId: "emp1", overrideGroupRuleId: "group", persen: 20 });
    const group = new Map([["emp1", "doctor_old"]]);
    expect(hitungKomisi([baris({ itemId: "it2", omzet: 300_000 })], [groupRule, exception], group)[0].komisi).toBe(0);
    expect(hitungKomisi([baris({ itemId: "it1", omzet: 100_000 })], [groupRule, exception], group)[0].komisi).toBe(0);
    expect(hitungKomisi([baris({ itemId: "it1", omzet: 300_000 })], [groupRule, exception], group)[0].komisi).toBe(60_000);
  });
  it("persen dari omzet", () => {
    expect(satu([baris()], [aturan()]).komisi).toBe(2_000);
  });

  it("persen dari laba memakai laba, bukan omzet", () => {
    expect(satu([baris()], [aturan({ basis: "laba", persen: 10 })]).komisi).toBe(4_000);
  });

  it("nominal dikali qty, bukan sekali per struk", () => {
    expect(satu([baris({ qty: 3 })], [aturan({ tipe: "nominal", nominal: 5_000 })]).komisi).toBe(15_000);
  });

  it("keeps a fractional quantity in nominal-rule evidence", () => {
    const result = satu([baris({ qty: 0.5 })], [aturan({ tipe: "nominal", nominal: 5_000 })]);
    expect(result.komisi).toBe(2_500);
    expect(result.rincian[0].dasar).toBe(0.5);
  });

  it("beberapa aturan bisa kena bersamaan", () => {
    const h = satu([baris()], [aturan(), aturan({ id: "r2", tipe: "nominal", nominal: 1_000 })]);
    expect(h.komisi).toBe(3_000);
    expect(h.rincian).toHaveLength(2);
  });

  it("cakupan cabang & karyawan menyaring", () => {
    expect(satu([baris()], [aturan({ branchId: "cab-lain" })])).toMatchObject({ komisi: 0, rincian: [] });
    expect(satu([baris()], [aturan({ employeeId: "emp-lain" })])).toMatchObject({ komisi: 0, rincian: [] });
    expect(satu([baris()], [aturan({ branchId: "cab1" })]).komisi).toBe(2_000);
  });

  it("aturan di kategori induk ikut menjaring produk kategori anak", () => {
    expect(satu([baris()], [aturan({ categoryId: "kat-induk" })]).komisi).toBe(2_000);
    expect(satu([baris()], [aturan({ categoryId: "kat-lain" })]).rincian).toHaveLength(0);
  });

  it("cakupan produk menyaring per SKU", () => {
    expect(satu([baris()], [aturan({ itemId: "it1" })]).komisi).toBe(2_000);
    expect(satu([baris()], [aturan({ itemId: "it2" })]).rincian).toHaveLength(0);
  });

  it("masa berlaku aturan menyaring per tanggal struk", () => {
    expect(satu([baris()], [aturan({ dari: "2026-08-11" })]).rincian).toHaveLength(0);
    expect(satu([baris()], [aturan({ sampai: "2026-08-09" })]).rincian).toHaveLength(0);
    expect(satu([baris()], [aturan({ dari: "2026-08-01", sampai: "2026-08-31" })]).komisi).toBe(2_000);
  });

  it("baris retur mengurangi dasar komisi", () => {
    const h = satu(
      [baris(), baris({ qty: -1, omzet: -100_000, laba: -40_000 })],
      [aturan()],
    );
    expect(h.omzet).toBe(0);
    expect(h.komisi).toBe(0);
  });

  it("komisi tidak pernah negatif walau retur melebihi penjualan", () => {
    const h = satu([baris({ qty: -2, omzet: -200_000, laba: -80_000 })], [aturan()]);
    expect(h.komisi).toBe(0);
  });

  it("ambang menahan komisi sampai realisasi tembus", () => {
    const kurang = satu([baris()], [aturan({ minOmzet: 500_000 })]);
    expect(kurang.komisi).toBe(0);
    expect(kurang.rincian[0]).toMatchObject({ cair: false, dasar: 100_000 });

    const tembus = satu([baris({ omzet: 600_000 })], [aturan({ minOmzet: 500_000 })]);
    expect(tembus.komisi).toBe(12_000);
    expect(tembus.rincian[0].cair).toBe(true);
  });

  it("ambang basis laba diukur dari laba, bukan omzet", () => {
    // Omzet 100rb sudah lewat ambang 50rb, tapi labanya cuma 40rb → belum cair.
    const h = satu([baris()], [aturan({ basis: "laba", persen: 10, minOmzet: 50_000 })]);
    expect(h.komisi).toBe(0);
  });

  it("baris tanpa HPP dilewati di basis laba, tapi tetap dihitung di basis omzet", () => {
    const b = [baris(), baris({ itemId: "it2", laba: null })];
    expect(satu(b, [aturan({ basis: "laba", persen: 10 })]).komisi).toBe(4_000);
    expect(satu(b, [aturan()]).komisi).toBe(4_000); // 2% × 200rb
    expect(satu(b, [aturan()]).barisTanpaHpp).toBe(1);
  });

  it("memisahkan hasil per karyawan", () => {
    const h = hitungKomisi([baris(), baris({ employeeId: "emp2", omzet: 50_000 })], [aturan()]);
    expect(h).toHaveLength(2);
    expect(h.find((x) => x.employeeId === "emp2")?.komisi).toBe(1_000);
  });

  it("aturan khusus klinik tidak ikut membayar penjualan kasir, dan sebaliknya", () => {
    const kasir = baris();
    const klinik = baris({ sumber: "klinik" });

    expect(satu([kasir], [aturan({ sumber: "klinik" })]).rincian).toHaveLength(0);
    expect(satu([klinik], [aturan({ sumber: "kasir" })]).rincian).toHaveLength(0);
    expect(satu([klinik], [aturan({ sumber: "klinik", persen: 5 })]).komisi).toBe(5_000);
    // 'semua' menjaring keduanya: 2% × 200rb.
    expect(satu([kasir, klinik], [aturan()]).komisi).toBe(4_000);
  });

  it("penjualan reseller punya sumbernya sendiri dan ikut terjaring 'semua'", () => {
    const reseller = baris({ sumber: "reseller", omzet: 3_000_000, laba: 900_000 });

    expect(satu([reseller], [aturan({ sumber: "reseller", persen: 1 })]).komisi).toBe(30_000);
    expect(satu([reseller], [aturan({ sumber: "kasir" })]).rincian).toHaveLength(0);
    expect(satu([baris()], [aturan({ sumber: "reseller" })]).rincian).toHaveLength(0);
    // 'semua' = kasir + klinik + reseller: 2% × (100rb + 3jt).
    expect(satu([baris(), reseller], [aturan()]).komisi).toBe(62_000);
  });

  it("realisasi target menghitung penjualan reseller", () => {
    const t: TargetPenjualan = { id: "t1", employeeId: "emp1", branchId: null, categoryId: null, basis: "omzet", target: 5_000_000 };
    const b = [baris({ omzet: 280_000 }), baris({ sumber: "reseller", omzet: 3_000_000 })];
    expect(realisasiTarget(b, t).realisasi).toBe(3_280_000);
  });

  it("baris tanpa penjual tidak dapat komisi", () => {
    expect(hitungKomisi([baris({ employeeId: null })], [aturan()])).toHaveLength(0);
  });
});

describe("realisasiTarget", () => {
  const target = (o: Partial<TargetPenjualan> = {}): TargetPenjualan => ({
    id: "t1", employeeId: null, branchId: null, categoryId: null, basis: "omzet", target: 1_000_000, ...o,
  });

  it("menjumlahkan omzet sesuai cakupan dan menghitung persen capai", () => {
    const b = [baris({ omzet: 400_000 }), baris({ employeeId: "emp2", branchId: "cab2", omzet: 600_000 })];
    expect(realisasiTarget(b, target())).toEqual({ realisasi: 1_000_000, persen: 100 });
    expect(realisasiTarget(b, target({ branchId: "cab1" })).realisasi).toBe(400_000);
    expect(realisasiTarget(b, target({ employeeId: "emp2" })).persen).toBe(60);
  });

  it("target basis laba memakai laba", () => {
    expect(realisasiTarget([baris()], target({ basis: "laba", target: 80_000 })))
      .toEqual({ realisasi: 40_000, persen: 50 });
  });

  it("target cabang tetap menghitung struk tanpa penjual", () => {
    const b = [baris({ employeeId: null, omzet: 250_000 })];
    expect(realisasiTarget(b, target({ branchId: "cab1" })).realisasi).toBe(250_000);
  });

  it("target kategori ikut kategori induk", () => {
    expect(realisasiTarget([baris()], target({ categoryId: "kat-induk" })).realisasi).toBe(100_000);
    expect(realisasiTarget([baris()], target({ categoryId: "kat-lain" })).realisasi).toBe(0);
  });
});
