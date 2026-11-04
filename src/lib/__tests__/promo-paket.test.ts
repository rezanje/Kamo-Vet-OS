import { describe, expect, it } from "vitest";
import {
  cekUkuranPaket, emptyPaketForm, estimasiHasil, angkaAmbigu, paketAkses, paketFormFromRule, paketFormFromSnapshot, paketValuesFromForm, parseAngka, parseBulat,
  pesanGalatPaket, ringkasAturanPaket, ringkasPaket, validatePaketForm, type PaketForm, type PaketItemInfo,
} from "@/lib/promo-paket";
import { syaratHasilDefFromRow } from "@/lib/promo-syarat-hasil-checkout";
import { validateSyaratHasilDef } from "@/lib/promo-syarat-hasil";

const IKAN = "11111111-1111-4111-8111-111111111111", DONAT = "22222222-2222-4222-8222-222222222222", ANC = "33333333-3333-4333-8333-333333333333";
const CAB = "44444444-4444-4444-8444-444444444444";
const info = (over: Partial<Record<string, PaketItemInfo>> = {}): Map<string, PaketItemInfo> => new Map(Object.entries({
  [IKAN]: { id: IKAN, code: "B1", name: "Bolt Ikan 800gr", units: ["PCS", "BOX"], active: true },
  [DONAT]: { id: DONAT, code: "B2", name: "Bolt Donat 800gr", units: ["PCS"], active: true },
  [ANC]: { id: ANC, code: "A1", name: "ANC Creamy Stick", units: ["PCS"], active: true },
  ...over,
}) as [string, PaketItemInfo][]);
const nameOf = (id: string) => info().get(id)?.name ?? "Barang tidak tersedia";
const ctx = (over: Record<string, unknown> = {}) => ({ today: "2026-11-04", items: info(), isOwner: true, ...over });

const andri = (over: Partial<PaketForm> = {}): PaketForm => ({
  name: "Beli 2 Bolt, ANC -Rp1.000", branchIds: [], validFrom: "2026-11-04", validUntil: "", repeat: true,
  syarat: [{ kind: "qty", min: "2", items: [{ item_id: IKAN, unit: "PCS" }, { item_id: DONAT, unit: "PCS" }] }],
  hasil: { items: [{ item_id: ANC, unit: "PCS" }], rewardQty: "1", discountType: "nominal", value: "1000", maxAmount: "" },
  belowHpp: { allowed: false, reason: "" }, ...over,
});
const msgs = (f: PaketForm, c = ctx()) => validatePaketForm(f, c).map((i) => i.message);

describe("parseBulat", () => {
  it.each([["2", 2], [" 15 ", 15], ["100.000", 100000], ["0", 0], ["1.000", 1000], ["1.000.000", 1000000]])("%s -> %s", (s, n) => expect(parseBulat(s)).toBe(n));
  it.each(["", "1.5", "1e3", "-1", "abc", "1,5", "1.00", "99999999999999999999", "٣", "0.001", "0.500", "00.100", "1.000,50", "1,000", "1.00.000", ".5", "1..000"])("%s -> null", (s) => expect(parseBulat(s)).toBeNull());
});

describe("parseAngka — id-ID (titik ribuan, koma desimal) dan en (titik desimal) tanpa salah baca", () => {
  it.each([
    ["1.000", 1000], ["12.500", 12500], ["1.000.000", 1000000], ["1,5", 1.5], ["0,001", 0.001], ["0.001", 0.001], ["0.500", 0.5], ["0,500", 0.5],
    ["1.000,50", 1000.5], ["1,000.50", 1000.5], ["1,000,000", 1000000], ["1.5", 1.5], ["2", 2], [" 15 ", 15], ["0", 0], ["1.0000", 1],
  ])("%s -> %s", (s, n) => expect(parseAngka(s)).toBe(n));
  it.each(["abc", "", "-1", "1e3", "00.100", "1,000", "1.00.000", "1..000", ".5", "1,5,5", "1.000,5,5", "1 000", "99999999999999999999"])("%s -> null", (s) => expect(parseAngka(s)).toBeNull());
  it("a lone '1,000' / '2,500' is ambiguous (1 or 1000?) and is flagged so the message can say so; '1.000' and '1,5' are not", () => {
    expect(angkaAmbigu("1,000")).toBe(true);
    expect(angkaAmbigu("2,500")).toBe(true);
    expect(angkaAmbigu("1.000")).toBe(false);
    expect(angkaAmbigu("1,5")).toBe(false);
    expect(angkaAmbigu("abc")).toBe(false);
  });
  it("validatePaketForm reads '0.001' as the decimal it is (rejected as not whole), never silently as Rp1", () => {
    const f = andri({ hasil: { ...andri().hasil, value: "0.001" } });
    expect(msgs(f)).toContain("Hasil: potongan nominal harus bilangan bulat Rp1–99.999.999.");
    const g = andri({ syarat: [{ kind: "nilai", min: "0.500" }] });
    expect(msgs(g).join(" ")).toContain("nilai minimum harus bilangan bulat");
  });
  it("the validation message explains an ambiguous separator", () => {
    const f = andri({ syarat: [{ kind: "qty", min: "1,000", items: [{ item_id: IKAN, unit: "PCS" }] }] });
    expect(msgs(f).join(" ")).toMatch(/1,000.*(1 atau 1000|ambigu)/);
  });
});

describe("cekUkuranPaket — cheap size/shape gate that runs BEFORE any master-data read", () => {
  const manyRefs = (n: number) => Array.from({ length: n }, (_, i) => ({ item_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, unit: "PCS" }));
  it("a normal form passes", () => expect(cekUkuranPaket(andri())).toEqual([]));
  it("more than 8 syarat rows, more than 50 items in a row, more than 20 hasil items → friendly Indonesian messages", () => {
    const rows = Array.from({ length: 9 }, () => ({ kind: "nilai" as const, min: "1000" }));
    expect(cekUkuranPaket(andri({ syarat: rows })).map((i) => i.message)).toContain("Syarat promo maksimal 8 baris.");
    expect(cekUkuranPaket(andri({ syarat: [{ kind: "qty", min: "1", items: manyRefs(51) }] })).map((i) => i.message)).toContain("Syarat 1: maksimal 50 barang.");
    expect(cekUkuranPaket(andri({ hasil: { ...andri().hasil, items: manyRefs(21) } })).map((i) => i.message)).toContain("Hasil: maksimal 20 barang.");
  });
  it("branch ids must be UUIDs: a friendly Indonesian message, never the database's raw cast error", () => {
    const m = cekUkuranPaket(andri({ branchIds: ["not-a-uuid", "x'--"] })).map((i) => i.message).join(" ");
    expect(m).toContain("Cabang tidak valid");
    expect(m).not.toMatch(/invalid input syntax|uuid/i);
    expect(cekUkuranPaket(andri({ branchIds: [CAB] }))).toEqual([]);
  });
});

describe("paketValuesFromForm (exact RPC p_values)", () => {
  it("builds exactly the nine keys save_promo_syarat_hasil accepts, numbers as numbers", () => {
    const v = paketValuesFromForm(andri(), "Beli 2 Bolt");
    expect(Object.keys(v).sort()).toEqual(["below_hpp", "branch_ids", "hasil", "name", "repeat", "suggest", "syarat", "valid_from", "valid_until"]);
    expect(v).toEqual({
      name: "Beli 2 Bolt, ANC -Rp1.000", suggest: "Beli 2 Bolt", branch_ids: [], valid_from: "2026-11-04", valid_until: null, repeat: true,
      syarat: [{ kind: "qty", min: 2, items: [{ item_id: IKAN, unit: "PCS" }, { item_id: DONAT, unit: "PCS" }] }],
      hasil: { kind: "barang", items: [{ item_id: ANC, unit: "PCS" }], reward_qty: 1, discount: { type: "nominal", value: 1000 } },
      below_hpp: { allowed: false },
    });
  });
  it("percent keeps the cap, nominal never carries a cap even when the field still holds text", () => {
    const pct = paketValuesFromForm(andri({ hasil: { ...andri().hasil, discountType: "percent", value: "50", maxAmount: "5000" } }), "");
    expect((pct.hasil as { discount: unknown }).discount).toEqual({ type: "percent", value: 50, max_amount: 5000 });
    const noCap = paketValuesFromForm(andri({ hasil: { ...andri().hasil, discountType: "percent", value: "50", maxAmount: "" } }), "");
    expect((noCap.hasil as { discount: unknown }).discount).toEqual({ type: "percent", value: 50 });
    const nom = paketValuesFromForm(andri({ hasil: { ...andri().hasil, discountType: "nominal", value: "1000", maxAmount: "5000" } }), "");
    expect((nom.hasil as { discount: unknown }).discount).toEqual({ type: "nominal", value: 1000 });
  });
  it("nilai row carries no items (whole cart); waiver sends only allowed+reason (ack_by/ack_at are stamped by the database)", () => {
    const v = paketValuesFromForm(andri({ syarat: [{ kind: "nilai", min: "100.000" }], belowHpp: { allowed: true, reason: "  barang hampir expired  " } }), "");
    expect(v.syarat).toEqual([{ kind: "nilai", min: 100000 }]);
    expect(v.below_hpp).toEqual({ allowed: true, reason: "barang hampir expired" });
  });
  it("trims the name, blank dates become null, branches pass through, suggest is cut to 200 characters", () => {
    const v = paketValuesFromForm(andri({ name: "  X  ", validFrom: "", branchIds: [CAB] }), "s".repeat(300));
    expect(v).toMatchObject({ name: "X", valid_from: null, branch_ids: [CAB] });
    expect((v.suggest as string).length).toBe(200);
  });
  it("what the form produces is accepted by the stage-3 loader and the engine validator (shape parity with the database CHECK)", () => {
    const forms = [andri(), andri({ repeat: false, syarat: [{ kind: "qty", min: "3", items: [{ item_id: IKAN, unit: "BOX" }] }, { kind: "nilai", min: "50000" }], hasil: { items: [{ item_id: ANC, unit: "PCS" }, { item_id: DONAT, unit: "PCS" }], rewardQty: "2", discountType: "percent", value: "100", maxAmount: "7000" } })];
    for (const f of forms) {
      const v = paketValuesFromForm(f, "x");
      const rule = { discount_mode: "syarat_hasil", suggest: v.suggest, syarat_hasil: { version: 1, repeat: v.repeat, syarat: v.syarat, hasil: v.hasil, below_hpp: v.below_hpp } };
      const def = syaratHasilDefFromRow({ id: "p", name: "n", rule }, { belowHppReleased: true });
      expect(def).not.toBeNull();
      expect(validateSyaratHasilDef(def)).toEqual({ ok: true });
    }
  });
});

describe("paketFormFromSnapshot / paketFormFromRule", () => {
  const snap = (rule: unknown, over: Record<string, unknown> = {}) => ({ version: "a".repeat(32), item_ids: [], promo: { id: "p1", name: "N", promo_type: "bundling", rule, is_active: false, branch_ids: [CAB], valid_from: "2026-11-04", valid_until: "2026-12-31", min_qty: null, max_qty: null, kelipatan: true, auto_apply: true, discount_type: null, discount_value: null, ...over } }) as never;
  it("round-trips the saved rule back into the form", () => {
    const v = paketValuesFromForm(andri({ branchIds: [CAB], validUntil: "2026-12-31" }), "x");
    const rule = { discount_mode: "syarat_hasil", suggest: "x", syarat_hasil: { version: 1, repeat: true, syarat: v.syarat, hasil: v.hasil, below_hpp: { allowed: false } } };
    const back = paketFormFromSnapshot(snap(rule, { name: "Beli 2 Bolt, ANC -Rp1.000" }));
    expect(back).toEqual(andri({ branchIds: [CAB], validUntil: "2026-12-31" }));
  });
  it("keeps a stored waiver reason; null for legacy promos or malformed rules (the editor then refuses to open)", () => {
    const v = paketValuesFromForm(andri(), "x");
    const rule = { discount_mode: "syarat_hasil", syarat_hasil: { version: 1, repeat: true, syarat: v.syarat, hasil: v.hasil, below_hpp: { allowed: true, reason: "barang reject sisa gudang", ack_by: "u", ack_at: "t" } } };
    expect(paketFormFromSnapshot(snap(rule))?.belowHpp).toEqual({ allowed: true, reason: "barang reject sisa gudang" });
    expect(paketFormFromSnapshot(snap({ discount_mode: "per_unit" }))).toBeNull();
    expect(paketFormFromSnapshot(snap({ discount_mode: "syarat_hasil", syarat_hasil: { version: 1 } }))).toBeNull();
    expect(paketFormFromRule(null)).toBeNull();
  });
});

describe("validatePaketForm (Indonesian, client-side; the database stays the authority)", () => {
  it("the Andri example is clean", () => expect(validatePaketForm(andri(), ctx())).toEqual([]));
  it("name", () => {
    expect(msgs(andri({ name: "  " }))).toContain("Nama promo wajib diisi.");
    expect(msgs(andri({ name: "x".repeat(121) }))).toContain("Nama promo maksimal 120 karakter.");
  });
  it("dates", () => {
    expect(msgs(andri({ validFrom: "2026-12-01", validUntil: "2026-11-30" }))).toContain("Tanggal berakhir lebih awal dari tanggal mulai.");
    expect(msgs(andri({ validFrom: "", validUntil: "2026-11-03" }))).toContain("Tanggal berakhir sudah lewat. Isi tanggal hari ini atau sesudahnya.");
    expect(msgs(andri({ validFrom: "2026-02-30" }))).toContain("Tanggal mulai tidak valid.");
  });
  it("syarat count 1..8", () => {
    expect(msgs(andri({ syarat: [] }))).toContain("Tambahkan minimal 1 syarat promo.");
    const nine = Array.from({ length: 9 }, () => ({ kind: "nilai" as const, min: "1000" }));
    expect(msgs(andri({ syarat: nine }))).toContain("Syarat promo maksimal 8 baris.");
    expect(msgs(andri({ syarat: nine.slice(0, 8) }))).toEqual([]);
  });
  it("qty row: minimum, items, units, inactive items", () => {
    const row = (o: Record<string, unknown>) => ({ kind: "qty" as const, min: "2", items: [{ item_id: IKAN, unit: "PCS" }], ...o }) as never;
    expect(msgs(andri({ syarat: [row({ min: "0" })] }))).toContain("Syarat 1: kuantitas minimum harus bilangan bulat 1–99.999.");
    expect(msgs(andri({ syarat: [row({ min: "1.5" })] }))).toContain("Syarat 1: kuantitas minimum harus bilangan bulat 1–99.999.");
    expect(msgs(andri({ syarat: [row({ min: "100000" })] }))).toContain("Syarat 1: kuantitas minimum harus bilangan bulat 1–99.999.");
    expect(msgs(andri({ syarat: [row({ items: [] })] }))).toContain("Syarat 1: pilih minimal 1 barang.");
    expect(msgs(andri({ syarat: [row({ items: [{ item_id: IKAN, unit: "KARUNG" }] })] }))).toContain("Syarat 1: satuan KARUNG bukan satuan resmi Bolt Ikan 800gr.");
    expect(msgs(andri({ syarat: [row({ items: [{ item_id: IKAN, unit: "PCS" }, { item_id: IKAN, unit: "PCS" }] })] }))).toContain("Syarat 1: Bolt Ikan 800gr (PCS) terpilih dua kali.");
    expect(msgs(andri({ syarat: [row({ items: [{ item_id: IKAN, unit: "PCS" }, { item_id: IKAN, unit: "BOX" }] })] }))).toEqual([]);
    expect(msgs(andri({ syarat: [row({})] }), ctx({ items: info({ [IKAN]: { id: IKAN, code: "B1", name: "Bolt Ikan 800gr", units: ["PCS"], active: false } }) }))).toContain("Syarat 1: Bolt Ikan 800gr tidak aktif / bukan barang persediaan.");
    expect(msgs(andri({ syarat: [row({ items: [{ item_id: "99999999-9999-4999-8999-999999999999", unit: "PCS" }] })] }))).toContain("Syarat 1: ada barang yang tidak tersedia. Lepaskan lalu pilih ulang.");
    const many = Array.from({ length: 51 }, (_, i) => ({ item_id: IKAN, unit: `U${i}` }));
    expect(msgs(andri({ syarat: [row({ items: many })] }))).toContain("Syarat 1: maksimal 50 barang.");
  });
  it("nilai row", () => {
    expect(msgs(andri({ syarat: [{ kind: "nilai", min: "0" }] }))).toContain("Syarat 1: nilai minimum harus bilangan bulat 1–99.999.999 (Rp).");
    expect(msgs(andri({ syarat: [{ kind: "nilai", min: "100000000" }] }))).toContain("Syarat 1: nilai minimum harus bilangan bulat 1–99.999.999 (Rp).");
    expect(msgs(andri({ syarat: [{ kind: "nilai", min: "100000" }] }))).toEqual([]);
  });
  it("hasil: items, reward qty, discount ranges", () => {
    const h = (o: Record<string, unknown>) => andri({ hasil: { ...andri().hasil, ...o } as never });
    expect(msgs(h({ items: [] }))).toContain("Hasil: pilih minimal 1 barang hasil.");
    expect(msgs(h({ items: Array.from({ length: 21 }, (_, i) => ({ item_id: ANC, unit: `U${i}` })) }))).toContain("Hasil: maksimal 20 barang.");
    expect(msgs(h({ rewardQty: "0" }))).toContain("Hasil: jumlah barang hasil per kelipatan harus bilangan bulat 1–999.");
    expect(msgs(h({ value: "0" }))).toContain("Hasil: potongan nominal harus bilangan bulat Rp1–99.999.999.");
    expect(msgs(h({ discountType: "percent", value: "101" }))).toContain("Hasil: potongan persen harus bilangan bulat 1–100.");
    expect(msgs(h({ discountType: "percent", value: "10", maxAmount: "0" }))).toContain("Hasil: maksimum diskon harus bilangan bulat Rp1–99.999.999 (atau kosongkan).");
    expect(msgs(h({ discountType: "percent", value: "10", maxAmount: "" }))).toEqual([]);
  });
  it("waiver: Owner only, with a reason of at least 10 characters", () => {
    const w = (reason: string) => andri({ belowHpp: { allowed: true, reason } });
    expect(msgs(w("barang reject sisa gudang"), ctx({ isOwner: false }))).toContain("Hanya Owner yang boleh mengizinkan penjualan di bawah HPP.");
    expect(msgs(w("pendek"))).toContain("Alasan izin di bawah HPP minimal 10 karakter.");
    expect(msgs(w("x".repeat(201)))).toContain("Alasan izin di bawah HPP maksimal 200 karakter.");
    expect(msgs(w("barang reject sisa gudang"))).toEqual([]);
  });
  it("reports every problem at once with the field it belongs to", () => {
    const issues = validatePaketForm(andri({ name: "", syarat: [] }), ctx());
    expect(issues.map((i) => i.field).sort()).toEqual(["name", "syarat"]);
  });
});

describe("ringkasPaket — live preview sentence (unit chosen per item is always shown)", () => {
  it("Andri example", () => {
    expect(ringkasPaket(andri(), nameOf)).toBe("Beli 2 PCS Bolt Ikan 800gr / Bolt Donat 800gr (campur varian) → potongan Rp1.000 per PCS ANC Creamy Stick, berlaku kelipatan");
  });
  it("shows the chosen unit: 'Beli 2 DUS Bolt Ikan' and 'potongan Rp1.000 per PCS ANC Creamy Stick'", () => {
    const f = andri({ syarat: [{ kind: "qty", min: "2", items: [{ item_id: IKAN, unit: "DUS" }] }] });
    const s = ringkasPaket(f, nameOf);
    expect(s).toContain("Beli 2 DUS Bolt Ikan 800gr");
    expect(s).toContain("potongan Rp1.000 per PCS ANC Creamy Stick");
    const g = andri({ hasil: { ...andri().hasil, items: [{ item_id: ANC, unit: "DUS" }] } });
    expect(ringkasPaket(g, nameOf)).toContain("potongan Rp1.000 per DUS ANC Creamy Stick");
  });
  it("mixed units inside one row are summarised sensibly, not shown like a single-unit row", () => {
    const f = andri({ syarat: [{ kind: "qty", min: "2", items: [{ item_id: IKAN, unit: "DUS" }, { item_id: DONAT, unit: "PCS" }] }] });
    expect(ringkasPaket(f, nameOf)).toContain("Beli 2 unit Bolt Ikan 800gr (DUS) / Bolt Donat 800gr (PCS) (campur varian, campur satuan)");
    const many = andri({ syarat: [{ kind: "qty", min: "2", items: [{ item_id: IKAN, unit: "DUS" }, { item_id: DONAT, unit: "PCS" }, { item_id: ANC, unit: "PCS" }, { item_id: IKAN, unit: "PCS" }] }] });
    expect(ringkasPaket(many, nameOf)).toContain("Beli 2 unit Bolt Ikan 800gr (DUS) / Bolt Donat 800gr (PCS) +2 varian (campur varian, campur satuan: DUS, PCS)");
    const h = andri({ hasil: { ...andri().hasil, items: [{ item_id: ANC, unit: "PCS" }, { item_id: IKAN, unit: "DUS" }] } });
    expect(ringkasPaket(h, nameOf)).toContain("potongan Rp1.000 per unit ANC Creamy Stick (PCS) / Bolt Ikan 800gr (DUS) (campur satuan)");
  });
  it("percent with cap, several rows, no repeat, reward qty, many variants (single unit)", () => {
    const f = andri({
      repeat: false,
      syarat: [{ kind: "qty", min: "3", items: [{ item_id: IKAN, unit: "PCS" }] }, { kind: "nilai", min: "100000" }],
      hasil: { items: [{ item_id: ANC, unit: "PCS" }, { item_id: DONAT, unit: "PCS" }, { item_id: IKAN, unit: "PCS" }, { item_id: ANC, unit: "PCS" }], rewardQty: "2", discountType: "percent", value: "50", maxAmount: "5000" },
    });
    expect(ringkasPaket(f, nameOf)).toBe("Beli 3 PCS Bolt Ikan 800gr DAN belanja minimal Rp100.000 → potongan 50% per PCS ANC Creamy Stick / Bolt Donat 800gr +2 varian, maks. diskon Rp5.000 per PCS, maks. 2 PCS per kelipatan, sekali saja");
  });
  it("percent with a mixed-unit reward group says 'unit', and lists the units", () => {
    const f = andri({ repeat: false, hasil: { items: [{ item_id: ANC, unit: "PCS" }, { item_id: DONAT, unit: "PCS" }, { item_id: IKAN, unit: "PCS" }, { item_id: IKAN, unit: "BOX" }], rewardQty: "2", discountType: "percent", value: "50", maxAmount: "5000" } });
    expect(ringkasPaket(f, nameOf)).toContain("→ potongan 50% per unit ANC Creamy Stick (PCS) / Bolt Donat 800gr (PCS) +2 varian (campur satuan: BOX, PCS), maks. diskon Rp5.000 per unit, maks. 2 unit per kelipatan, sekali saja");
  });
  it("incomplete forms still render something readable instead of throwing", () => {
    expect(ringkasPaket(emptyPaketForm("2026-11-04"), nameOf)).toContain("belum lengkap");
  });
  it("list summary from a stored rule", () => {
    const v = paketValuesFromForm(andri(), "x");
    const rule = { discount_mode: "syarat_hasil", syarat_hasil: { version: 1, repeat: true, syarat: v.syarat, hasil: v.hasil, below_hpp: { allowed: false } } };
    expect(ringkasAturanPaket(rule, nameOf)).toContain("potongan Rp1.000 per PCS ANC Creamy Stick");
    expect(ringkasAturanPaket({}, nameOf)).toBe("—");
  });
  it("the generated suggest text is cut at 200 characters but still starts with the unit-aware sentence", () => {
    const v = paketValuesFromForm(andri(), ringkasPaket(andri(), nameOf));
    expect(v.suggest).toContain("Beli 2 PCS");
    expect((v.suggest as string).length).toBeLessThanOrEqual(200);
  });
});

describe("estimasiHasil — estimated loss per unit from HPP", () => {
  it("nominal below HPP", () => expect(estimasiHasil({ price: 15000, hpp: 14500, discount: { type: "nominal", value: 1000 } })).toEqual({ discountPerUnit: 1000, netPerUnit: 14000, hpp: 14500, belowHpp: true, lossPerUnit: 500 }));
  it("nominal above HPP: no loss", () => expect(estimasiHasil({ price: 20000, hpp: 14500, discount: { type: "nominal", value: 1000 } })).toMatchObject({ belowHpp: false, lossPerUnit: 0, netPerUnit: 19000 }));
  it("net equal to HPP is not a loss", () => expect(estimasiHasil({ price: 15500, hpp: 14500, discount: { type: "nominal", value: 1000 } })).toMatchObject({ belowHpp: false, lossPerUnit: 0 }));
  it("percent half-up, capped per unit", () => {
    expect(estimasiHasil({ price: 10001, hpp: 1, discount: { type: "percent", value: 50 } }).discountPerUnit).toBe(5001);
    expect(estimasiHasil({ price: 40000, hpp: 1, discount: { type: "percent", value: 50, maxAmount: 5000 } })).toMatchObject({ discountPerUnit: 5000, netPerUnit: 35000 });
  });
  it("never discounts below Rp1 (engine rule): net stays >= 1", () => expect(estimasiHasil({ price: 500, hpp: 300, discount: { type: "percent", value: 100 } })).toMatchObject({ discountPerUnit: 499, netPerUnit: 1, belowHpp: true, lossPerUnit: 299 }));
  it("unknown HPP is reported as unknown, never as safe", () => expect(estimasiHasil({ price: 15000, hpp: null, discount: { type: "nominal", value: 1000 } })).toMatchObject({ belowHpp: null, lossPerUnit: 0, hpp: null }));
});

describe("pesanGalatPaket — database refusals in Indonesian", () => {
  const e = (code: string, message: string) => pesanGalatPaket({ code, message });
  it("release flag OFF", () => {
    expect(e("55000", "PROMO_SH_RELEASE: promo Syarat-Hasil belum dirilis; aplikasi harus live")).toBe("Fitur promo paket belum dirilis oleh Owner. Promo tetap tersimpan sebagai draf dan bisa diaktifkan setelah dirilis.");
    expect(e("55000", "PROMO_SH_RELEASE: izin di bawah HPP belum dirilis")).toBe("Izin penjualan di bawah HPP belum dirilis oleh Owner. Matikan izin tersebut atau tunggu rilis.");
  });
  it("stale version", () => expect(e("40001", "PROMO_EDIT_CONFLICT: Promo sudah berubah.")).toContain("diubah orang lain"));
  it("owner-only waiver, active edit, duplicate, target, manager", () => {
    expect(e("42501", "PROMO_SH_OWNER_ONLY: x")).toBe("Hanya Owner yang boleh mengizinkan penjualan di bawah HPP.");
    expect(e("55000", "PROMO_SH_ACTIVE_EDIT: x")).toBe("Promo sedang aktif. Nonaktifkan dulu sebelum mengubah isinya.");
    expect(e("23505", "PROMO_SH_DUPLICATE: x")).toBe("Sudah ada promo aktif dengan aturan yang sama pada tanggal dan cabang yang beririsan.");
    expect(e("23514", "PROMO_SH_TARGET: barang syarat/hasil harus ada, aktif, dan berjenis Persediaan")).toBe("Barang promo bermasalah: barang syarat/hasil harus ada, aktif, dan berjenis Persediaan");
    expect(e("42501", "Hanya owner/manajer aktif yang bisa mengatur promo")).toBe("Hanya Owner/Admin aktif yang bisa mengatur promo.");
    expect(e("23514", "PROMO_SH_NO_DELETE: x")).toBe("Promo paket tidak bisa dihapus. Nonaktifkan saja.");
  });
  it("expired promo activation: the database's KADALUARSA text is shown cleanly, without the raw 'Gagal menyimpan promo:' prefix", () => {
    const msg = e("23514", 'KADALUARSA: Promo "Beli 2 Bolt" berakhir 2026-10-13 dan sudah lewat. Perpanjang dulu tanggal "Berlaku s/d" sebelum diaktifkan kembali.');
    expect(msg).toBe('Promo "Beli 2 Bolt" berakhir 2026-10-13 dan sudah lewat. Perpanjang dulu tanggal "Berlaku s/d" sebelum diaktifkan kembali.');
    expect(msg).not.toContain("Gagal menyimpan promo");
    expect(e("P0001", "PROMO_KADALUARSA_GUARD_DRIFT: guard berubah")).toContain("Gagal menyimpan promo:");
  });
  it("rule problems keep the database's Indonesian detail; unknown errors never leak as success", () => {
    expect(e("22023", "PROMO_SH_RULE: SH_ROW_INVALID: kuantitas minimum harus bilangan bulat 1..99999")).toBe("Aturan promo ditolak: kuantitas minimum harus bilangan bulat 1..99999");
    expect(e("XX000", "boom")).toBe("Gagal menyimpan promo: boom");
    expect(pesanGalatPaket(null)).toBe("Gagal menyimpan promo. Coba lagi.");
  });
});

describe("paketAkses — role gate", () => {
  it("OWNER and ADMIN (active) may manage; only OWNER may waive HPP", () => {
    expect(paketAkses({ role: "OWNER", is_active: true })).toEqual({ allowed: true, isOwner: true });
    expect(paketAkses({ role: "ADMIN", is_active: true })).toEqual({ allowed: true, isOwner: false });
  });
  it.each([[{ role: "STAFF", is_active: true }], [{ role: "OWNER", is_active: false }], [{ role: "ADMIN" }], [null], [undefined], [{ role: "KASIR", is_active: true }]])("%j is refused", (me) =>
    expect(paketAkses(me as never)).toEqual({ allowed: false, isOwner: false }));
});
