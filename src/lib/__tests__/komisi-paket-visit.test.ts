import { describe, expect, it } from "vitest";
import { barisVisitRanap, hitungKomisi, ringkasPaket, type AturanKomisi, type BarisJual, type LogVisitDokter } from "../komisi";

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

  it("a component without HPP keeps the package profit unknown, and mixed sellers stay unassigned", () => {
    const rows = ringkasPaket([
      baris({ paketAsal: paket, laba: null }),
      baris({ paketAsal: paket, employeeId: "other" }),
    ]);
    expect(rows[0].laba).toBeNull();
    expect(rows[0].employeeId).toBeNull();
  });

  it("a component line that slipped past folding is never paid as a normal SKU", () => {
    expect(hitungKomisi([baris({ paketAsal: paket })], [aturan({ itemId: "vaksin" })])[0].komisi).toBe(0);
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
