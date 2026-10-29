import { describe, expect, it } from "vitest";
import { bagiRupiahRata, barisVisitRanap, hitungKomisi, peringatanAturanKomisi, ringkasPaket, type AturanKomisi, type BarisJual, type LogVisitDokter } from "../komisi";

// Fictional fixture values only; no production tariff is configured here.
const baris = (o: Partial<BarisJual> = {}): BarisJual => ({
  tanggal: "2026-10-10", sumber: "klinik", employeeId: "doc", branchId: "cab", itemId: "vaksin",
  kategoriIds: ["kat-vaksin"], qty: 1, omzet: 100_000, laba: 40_000, sourceDocumentId: "inv1", ...o,
});
const aturan = (o: Partial<AturanKomisi> = {}): AturanKomisi => ({
  id: "r", nama: "Aturan", tipe: "nominal", basis: "omzet", sumber: "semua", persen: 0, nominal: 1_000,
  employeeId: null, branchId: null, categoryId: null, itemId: null, minOmzet: 0, dari: null, sampai: null, ...o,
});
const paket = { itemId: "paket-vaksin", qty: 3, kategoriIds: ["kat-paket"] };

describe("H05 package components", () => {
  it("3 bundles + 1 normal vaccine: SKU rule counts 1, package rule counts 3", () => {
    const rows = ringkasPaket([
      baris({ qty: 3, omzet: 240_000, laba: 90_000, paketAsal: paket }),
      baris({ qty: 1, omzet: 100_000, laba: 40_000 }),
    ]);
    const sku = aturan({ id: "sku", itemId: "vaksin" });
    const pkg = aturan({ id: "pkg", itemId: "paket-vaksin", nominal: 2_000 });
    const [hasil] = hitungKomisi(rows, [sku, pkg]);
    expect(hasil.rincian.find(r => r.aturanId === "sku")?.dasar).toBe(1);
    expect(hasil.rincian.find(r => r.aturanId === "pkg")?.dasar).toBe(3);
    // Omzet counts once: package row + normal line, never component + package.
    expect(hasil.omzet).toBe(340_000);
  });

  it("folds every component of one package into a single package row", () => {
    const rows = ringkasPaket([
      baris({ itemId: "vaksin", qty: 3, omzet: 150_000, laba: 50_000, paketAsal: paket }),
      baris({ itemId: "jasa-suntik", qty: 3, omzet: 90_000, laba: 90_000, paketAsal: paket }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ itemId: "paket-vaksin", qty: 3, omzet: 240_000, laba: 140_000, paketKomponen: 2, kategoriIds: ["kat-paket"] });
  });

  it("a component without HPP keeps the package profit unknown", () => {
    const rows = ringkasPaket([baris({ paketAsal: paket, laba: null }), baris({ paketAsal: paket })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].laba).toBeNull();
  });

  it("components sold by different people keep their seller; the package qty is split evenly", () => {
    const rows = ringkasPaket([
      baris({ paketAsal: paket, omzet: 60_000 }),
      baris({ paketAsal: paket, employeeId: "other", omzet: 40_000 }),
    ]);
    expect(rows.map(r => [r.employeeId, r.qty, r.omzet])).toEqual([["doc", 1.5, 60_000], ["other", 1.5, 40_000]]);
    const [doc, other] = hitungKomisi(rows, [aturan({ itemId: "paket-vaksin" })]);
    expect([doc.komisi, other.komisi]).toEqual([1_500, 1_500]);
  });

  describe("owner decision 29 Oct: package nominal split evenly among distinct sellers", () => {
    const satu = { itemId: "paket-vaksin", qty: 1, kategoriIds: ["kat-paket"] };
    const rule = aturan({ id: "pkg", itemId: "paket-vaksin", nominal: 10_001 });
    const komisiPer = (rows: BarisJual[]) => Object.fromEntries(hitungKomisi(ringkasPaket(rows), [rule]).map(h => [h.employeeId, h.komisi]));

    it("1 seller (several lines) keeps the whole nominal", () => {
      expect(komisiPer([baris({ paketAsal: satu }), baris({ paketAsal: satu, itemId: "jasa-suntik" })])).toEqual({ doc: 10_001 });
    });

    it("2 sellers split in rupiah, remainder to the first seller", () => {
      expect(komisiPer([baris({ paketAsal: satu }), baris({ paketAsal: satu, employeeId: "b" })])).toEqual({ doc: 5_001, b: 5_000 });
    });

    it("3 sellers split in rupiah; the same seller on two lines counts once; total is exact", () => {
      const hasil = komisiPer([
        baris({ paketAsal: satu, employeeId: "c" }),
        baris({ paketAsal: satu, employeeId: "a" }),
        baris({ paketAsal: satu, employeeId: "c", itemId: "jasa-suntik" }),
        baris({ paketAsal: satu, employeeId: "b" }),
      ]);
      expect(hasil).toEqual({ c: 3_335, a: 3_333, b: 3_333 });
      expect(Object.values(hasil).reduce((x, y) => x + y, 0)).toBe(10_001);
    });

    it("a line without any seller takes no share; qty 3 packages x 3 sellers", () => {
      const rows = ringkasPaket([
        baris({ paketAsal: paket, employeeId: null }),
        baris({ paketAsal: paket, employeeId: "a" }),
        baris({ paketAsal: paket, employeeId: "b" }),
        baris({ paketAsal: paket, employeeId: "c" }),
      ]);
      expect(rows.map(r => r.qty)).toEqual([0, 1, 1, 1]);
      const hasil = hitungKomisi(rows, [aturan({ itemId: "paket-vaksin", nominal: 1_001 })]);
      expect(hasil.map(h => [h.employeeId, h.komisi])).toEqual([["a", 1_001], ["b", 1_001], ["c", 1_001]]);
    });

    it("a refund of a two-seller package reverses the same even split", () => {
      const hasil = komisiPer([
        baris({ paketAsal: satu }), baris({ paketAsal: satu, employeeId: "b" }),
        baris({ tanggal: "2026-10-12", qty: -1, omzet: -100_000, paketAsal: satu }),
        baris({ tanggal: "2026-10-12", qty: -1, omzet: -100_000, paketAsal: satu, employeeId: "b" }),
      ]);
      expect(hasil).toEqual({ doc: 0, b: 0 });
    });

    it("splits whole rupiah deterministically", () => {
      expect([0, 1, 2].map(ke => bagiRupiahRata(100, 3, ke))).toEqual([34, 33, 33]);
      expect([0, 1].map(ke => bagiRupiahRata(-101, 2, ke))).toEqual([-51, -50]);
      expect(bagiRupiahRata(777, 1, 0)).toBe(777);
    });
  });

  it("a service component with two performers keeps its own row and counts as one seller", () => {
    const performers = { doctor_id: "doc", staff_id: "nurse" } as unknown as BarisJual["servicePerformers"];
    const rows = ringkasPaket([
      baris({ paketAsal: paket, employeeId: "seller" }),
      baris({ paketAsal: paket, employeeId: null, commissionPending: true, servicePerformers: performers, itemId: "jasa-suntik" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ itemId: "paket-vaksin", qty: 1.5, commissionPending: true, servicePerformers: performers });
    expect(rows[1].paketAsal).toBeUndefined();
    // Both performers paid in full on that slot (S04 "both_full"): each actor keeps the slot qty.
    const actors = [rows[0], { ...rows[1], employeeId: "doc", commissionPending: false }, { ...rows[1], employeeId: "nurse", commissionPending: false }];
    const hasil = hitungKomisi(actors, [aturan({ itemId: "paket-vaksin", nominal: 1_001 })]);
    expect(hasil.map(h => [h.employeeId, h.komisi])).toEqual([["seller", 1_502], ["doc", 1_501], ["nurse", 1_501]]);
  });

  it("a component line that slipped past folding is never paid as a normal SKU", () => {
    expect(hitungKomisi([baris({ paketAsal: paket })], [aturan({ itemId: "vaksin" })])[0].komisi).toBe(0);
  });

  it("a clinic refund of half a package component reverses half the package qty and its omzet", () => {
    const rows = ringkasPaket([
      baris({ qty: 3, omzet: 300_000, paketAsal: paket }),
      baris({ tanggal: "2026-11-02", qty: -1.5, omzet: -150_000, paketAsal: { ...paket, qty: 1.5 } }),
    ]);
    expect(rows.map(r => [r.qty, r.omzet])).toEqual([[3, 300_000], [-1.5, -150_000]]);
  });

  it("packages on different invoices stay separate", () => {
    const rows = ringkasPaket([baris({ paketAsal: paket }), baris({ paketAsal: paket, sourceDocumentId: "inv2" })]);
    expect(rows.map(r => r.qty)).toEqual([3, 3]);
  });
});

describe("H06 inpatient visit incentive", () => {
  const log = (o: Partial<LogVisitDokter> = {}): LogVisitDokter => ({
    id: "l1", inpatientRecordId: "stay1", doctorId: "doc", branchId: "cab", createdAt: "2026-10-10T02:00:00Z", ...o,
  });

  it("counts at most one visit per doctor per stay per Jakarta date and keeps the duplicate as evidence", () => {
    const { baris: rows, dobel } = barisVisitRanap([
      log({ id: "l2", createdAt: "2026-10-10T09:00:00Z" }),
      log({ id: "l1", createdAt: "2026-10-10T02:00:00Z" }),
      log({ id: "l3", doctorId: "doc2" }),
      log({ id: "l4", inpatientRecordId: "stay2" }),
    ]);
    expect(rows.map(r => r.sourceLineId).sort()).toEqual(["l1", "l3", "l4"]);
    expect(dobel).toMatchObject([{ id: "l2", dihitungLogId: "l1", tanggal: "2026-10-10" }]);
  });

  it("uses the Asia/Jakarta calendar date, not UTC", () => {
    // 17:30 UTC on the 9th is 00:30 WIB on the 10th: a different visit day from 10:00 UTC on the 9th.
    const { baris: rows } = barisVisitRanap([log({ id: "a", createdAt: "2026-10-09T10:00:00Z" }), log({ id: "b", createdAt: "2026-10-09T17:30:00Z" })]);
    expect(rows.map(r => r.visitTanggal)).toEqual(["2026-10-09", "2026-10-10"]);
  });

  it("is paid only by visit rules, at the configured rate per visit", () => {
    const { baris: rows } = barisVisitRanap([log({ id: "a" }), log({ id: "b", createdAt: "2026-10-11T02:00:00Z" })]);
    const visitRule = aturan({ id: "visit", sumber: "visit_ranap", nominal: 7_000 });
    const salesRule = aturan({ id: "sales", sumber: "semua", nominal: 5_000 });
    const [hasil] = hitungKomisi(rows, [visitRule, salesRule]);
    expect(hasil.komisi).toBe(14_000);
    expect(hasil.rincian.map(r => r.aturanId)).toEqual(["visit"]);
    expect(hitungKomisi([baris()], [visitRule])[0].komisi).toBe(0);
  });

  it("a log without a doctor never counts", () => {
    expect(barisVisitRanap([log({ doctorId: null })]).baris).toHaveLength(0);
  });
});

describe("H04 stale configuration warnings", () => {
  it("flags an exception whose employee left the group, one without an active group rule, and an empty group", () => {
    const group = aturan({ id: "g", nama: "Dokter lama", commissionGroup: "dokter_lama" });
    const moved = aturan({ id: "e1", nama: "Khusus A", employeeId: "a", overrideGroupRuleId: "g" });
    const orphan = aturan({ id: "e2", nama: "Khusus B", employeeId: "b", overrideGroupRuleId: "gone" });
    const empty = aturan({ id: "g2", nama: "Groomer", commissionGroup: "groomer" });
    const warnings = peringatanAturanKomisi([group, moved, orphan, empty], new Map([["a", "dokter_baru"], ["c", "dokter_lama"]]), new Map([["a", "Ana"]]));
    expect(warnings).toEqual([
      expect.stringContaining("Ana tidak lagi di kelompok dokter_lama"),
      expect.stringContaining("Khusus B"),
      expect.stringContaining("belum ada karyawan di kelompok groomer"),
    ]);
  });
});
