import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPromoSelection, pesanPromoSyaratHasil } from "../promo-syarat-hasil-checkout";
import { cashierPriceFloorDbMessage } from "../cashier-price-floor";

// Every PROMO_SH_* the database can raise must reach the cashier in Indonesian with a "what to do" hint (stage 3b item 3).
const MIGRATIONS = join(__dirname, "../../../supabase/migrations");
const codesInMigrations = (): string[] => {
  const files = readdirSync(MIGRATIONS).filter((f) => /^202611065[0-2]0000_promo_syarat_hasil/.test(f));
  const codes = new Set<string>();
  for (const f of files) for (const m of readFileSync(join(MIGRATIONS, f), "utf8").matchAll(/PROMO_SH_([A-Z_]+)/g)) codes.add(m[1]);
  return [...codes].sort();
};
const ENGLISH = /\b(the|promo is|refresh quote|required|must|cannot|exist|differs|claim must|inactive|expired|forged)\b/i;

describe("pesanPromoSyaratHasil: all PROMO_SH_* codes", () => {
  it("the migrations are scanned (guards against an empty scan) and contain the insert-time and finalization codes", () => {
    const codes = codesInMigrations();
    for (const c of ["CLAIM", "SNAPSHOT", "RELEASE", "PICK", "ELIGIBILITY", "TOTAL", "NILAI", "HPP", "WAIVER", "GRANTS", "SYARAT", "SETS", "LINE", "RULE", "TARGET", "POSITION", "POST"]) expect(codes).toContain(c);
  });
  it("every code in the migrations maps to an Indonesian message with a hint, never the raw DB text and never the generic fallback", () => {
    for (const code of codesInMigrations()) {
      const raw = `PROMO_SH_${code}: some english database text that must never be shown`;
      const out = pesanPromoSyaratHasil(raw);
      expect(out, code).toMatch(/^Promo bundling ditolak: /);
      expect(out, code).not.toContain("PROMO_SH");
      expect(out, code).not.toContain("some english");
      expect(out, code).not.toMatch(ENGLISH);
      expect(out, code).not.toContain("aturan promo berubah"); // that is the unknown-code fallback only
      expect(out, code).toMatch(/(Muat ulang|Hapus|Pilih|Minta|Hubungi|Kurangi|Tambah|Coba|Ganti|Nonaktifkan|Gunakan|Periksa|Buat)/); // a "what to do"
    }
  });
  it("unknown future code: still Indonesian, still a hint", () => {
    const out = pesanPromoSyaratHasil("PROMO_SH_BRAND_NEW: x");
    expect(out).toContain("aturan promo berubah");
    expect(out).toContain("Muat ulang kasir");
  });
  it("insert-time variants are specific: manual line discount, waiver line shape, missing source position", () => {
    expect(pesanPromoSyaratHasil("PROMO_SH_CLAIM: a manual line discount cannot take part in a promo claim")).toContain("diskon manual");
    expect(pesanPromoSyaratHasil("PROMO_SH_CLAIM: the promo has no Owner below-HPP waiver")).toMatch(/izin.*(di bawah modal|HPP)/i);
    expect(pesanPromoSyaratHasil("PROMO_SH_CLAIM: a below-HPP waiver line (promo_floor_waiver) may only contain reward units")).toContain("Muat ulang");
    expect(pesanPromoSyaratHasil("PROMO_SH_SNAPSHOT: promo claim is immutable")).not.toContain("immutable");
    expect(pesanPromoSyaratHasil("PROMO_SH_RELEASE: promo picker is not released")).toContain("pemilih promo");
    expect(pesanPromoSyaratHasil("PROMO_SH_RELEASE: syarat_hasil is not released")).not.toContain("pemilih promo");
  });
  it("the finalization messages keep their meaning (nilai, total, hpp, waiver)", () => {
    expect(pesanPromoSyaratHasil("PROMO_SH_NILAI: whole-cart value 1 is below 1 x 500")).toContain("Nilai belanja");
    expect(pesanPromoSyaratHasil("PROMO_SH_TOTAL: refresh quote")).toContain("berubah");
    expect(pesanPromoSyaratHasil("PROMO_SH_HPP: exact original stock and HPP provenance required")).toContain("HPP");
    expect(pesanPromoSyaratHasil("PROMO_SH_WAIVER: below-HPP waiver is not granted/released for this promo")).toMatch(/izin/i);
  });
  it("is found inside a longer message and ignores everything else", () => {
    expect(pesanPromoSyaratHasil("something PROMO_SH_NILAI: x trailing")).toContain("Nilai belanja");
    expect(pesanPromoSyaratHasil("Harga neto Persediaan di bawah HPP FIFO; penjualan ditolak: X")).toBeNull();
  });
});

describe("cashierPriceFloorDbMessage: waiver hint of the P03 floor", () => {
  it("a waiver line refused because the receipt is lower than after-promo subtotal says so in plain Indonesian", () => {
    const db = "Harga neto Persediaan di bawah HPP FIFO; penjualan ditolak: ANC Creamy (baris promo di bawah HPP: total struk tidak boleh lebih rendah dari subtotal setelah promo - tanpa voucher, poin, diskon total, atau pembulatan tunai ke bawah)";
    const out = cashierPriceFloorDbMessage(db);
    expect(out).toContain("ANC Creamy");
    expect(out).toMatch(/voucher.*poin.*diskon total/i);
    expect(out).not.toContain("(baris promo di bawah HPP");
  });
  it("the ordinary refusal is unchanged", () => {
    expect(cashierPriceFloorDbMessage("Harga neto Persediaan di bawah HPP FIFO; penjualan ditolak: ANC")).toBe("Harga neto ANC di bawah HPP FIFO. Naikkan harga atau kurangi diskon.");
  });
});

describe("buildPromoSelection (sales.promo_selection, display only, <= 8192 bytes)", () => {
  const composed = (n: number) => ({
    strategy: "syarat_hasil" as const,
    applied: [{ promo_id: "p1", name: "Promo satu", discount: 1000, kind: "syarat_hasil" as const }],
    notApplied: [],
    alternatives: Array.from({ length: n }, (_, i) => ({ promo_id: `alt-${i}`, name: "N".repeat(200), kind: "legacy" as const, saving: 100 + i, applied: false })),
    pick: { mode: "pilih" as const, promo_id: "p1", ok: true },
  });
  it("carries mode, pick, exclusive flag, applied, alternatives, dropped promos and notes", () => {
    const sel = buildPromoSelection(composed(2), "pilih", "u1", { pickId: "p1", exclusive: true, dropped: [{ promo_id: "px", name: "X", reason: "below_hpp" }] });
    expect(sel).toMatchObject({ version: 1, mode: "pilih", pick: "p1", exclusive: true, strategy: "syarat_hasil", by_user: "u1" });
    expect(sel.alternatives).toHaveLength(2);
    expect(sel.dropped).toEqual([{ promo_id: "px", name: "X", reason: "below_hpp" }]);
  });
  it("stays under 8192 bytes however many alternatives there are (names are cut, alternatives are capped/dropped)", () => {
    for (const n of [0, 5, 30, 500]) {
      const sel = buildPromoSelection(composed(n), "pilih", "u1", { pickId: "p1", exclusive: true });
      expect(Buffer.byteLength(JSON.stringify(sel), "utf8")).toBeLessThanOrEqual(8192);
      expect(sel.version).toBe(1);
    }
  });
  it("stays under 8192 bytes even with hundreds of APPLIED promos (applied is trimmed last)", () => {
    const many = { ...composed(0), applied: Array.from({ length: 400 }, (_, i) => ({ promo_id: `p-${i}-${"x".repeat(30)}`, name: "N".repeat(200), discount: 1000 + i, kind: "legacy" as const })), notApplied: Array.from({ length: 200 }, (_, i) => ({ promo_id: `n-${i}`, name: "M".repeat(200), saving: i })) };
    const sel = buildPromoSelection(many, "auto", "u1");
    expect(Buffer.byteLength(JSON.stringify(sel), "utf8")).toBeLessThanOrEqual(8192);
  });
  it("legacy two-argument call shape is unchanged (auto/tanpa)", () => {
    expect(buildPromoSelection({ strategy: "none", applied: [], notApplied: [] }, "tanpa", "u")).toMatchObject({ version: 1, mode: "tanpa", pick: null, exclusive: false, applied: [] });
  });
});
