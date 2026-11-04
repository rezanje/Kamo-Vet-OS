import { describe, expect, it } from "vitest";
import { loadPromoAktif } from "../promo-hitung";
import { loadSyaratHasilKasir, pesanPromoSyaratHasil, SYARAT_HASIL_OFF } from "../promo-syarat-hasil-checkout";

type Row = Record<string, unknown>;
const legacy = (id: string, extra: Row = {}) => ({ id, name: id, rule: {}, branch_ids: null, valid_from: null, valid_until: null, is_active: true, auto_apply: true, min_qty: null, max_qty: null, kelipatan: false, discount_type: "nominal", discount_value: 2000, ...extra });
const rule = (extra: Row = {}) => ({
  discount_mode: "syarat_hasil", suggest: "s",
  syarat_hasil: {
    version: 1, repeat: true,
    syarat: [{ kind: "qty", min: 2, items: [{ item_id: "ikan", unit: "PCS" }] }],
    hasil: { kind: "barang", items: [{ item_id: "anc", unit: "PCS" }], discount: { type: "nominal", value: 1000 } },
    below_hpp: { allowed: false }, ...extra,
  },
});
const sh = (id: string, extra: Row = {}) => legacy(id, { name: `SH ${id}`, rule: rule(), discount_type: null, discount_value: null, ...extra });

/** Mini PostgREST: .eq on plain columns and on `rule->>discount_mode`; counts reads; rpc() answers promo_release_enabled. */
function database(promos: Row[], flags: Record<string, boolean | Error> = {}) {
  const log = { tables: [] as string[], rpc: [] as string[], eq: [] as string[] };
  return {
    log,
    rpc: async (name: string, args: { p_flag: string }) => {
      log.rpc.push(`${name}:${args.p_flag}`);
      const f = flags[args.p_flag];
      if (f instanceof Error) return { data: null, error: { code: f.message, message: "x" } };
      return { data: f === true, error: null };
    },
    from(table: string) {
      log.tables.push(table);
      const eqs: [string, unknown][] = [];
      const run = (from: number, to: number) => {
        const matching = table === "promos" ? promos.filter((p) => eqs.every(([k, v]) => (k === "rule->>discount_mode" ? (p.rule as { discount_mode?: unknown } | null)?.discount_mode === v : p[k] === v))) : [];
        return { data: matching.slice(from, to + 1), error: null, count: matching.length };
      };
      const q = {
        select: () => q, eq: (k: string, v: unknown) => { eqs.push([k, v]); log.eq.push(k); return q; }, in: () => q, order: () => q,
        range: (a: number, b: number) => Promise.resolve(run(a, b)), then: (resolve: (x: unknown) => unknown) => Promise.resolve(run(0, 999)).then(resolve),
      };
      return q;
    },
  };
}

describe("loadPromoAktif leaves syarat_hasil promos to their own engine", () => {
  it("neither throws on them (a promo of the new mode must not break every checkout / clinic / POS) nor returns them", async () => {
    const db = database([legacy("a"), sh("x")]);
    const rules = await loadPromoAktif(db, "own");
    expect(rules.map((p) => p.id)).toEqual(["a"]);
  });
  it("an unknown mode still throws (fail closed is kept)", async () => {
    await expect(loadPromoAktif(database([legacy("p", { rule: { discount_mode: "mystery" } })]), "own")).rejects.toThrow("Cara hitung");
  });
  it("only a syarat_hasil promo active: no legacy promo, no target reads", async () => {
    const db = database([sh("x")]);
    expect(await loadPromoAktif(db, "own")).toEqual([]);
    expect(db.log.tables).not.toContain("promo_items");
  });
});

describe("loadSyaratHasilKasir", () => {
  it("no active syarat_hasil promo: OFF without any flag RPC (the common, flags-OFF case)", async () => {
    const db = database([legacy("a")], { syarat_hasil: true });
    expect(await loadSyaratHasilKasir(db, "own")).toEqual(SYARAT_HASIL_OFF);
    expect(db.log.rpc).toEqual([]);
  });
  it("promo active but the release flag is OFF: OFF", async () => {
    const db = database([sh("x")], { syarat_hasil: false, promo_picker: true });
    expect(await loadSyaratHasilKasir(db, "own")).toEqual(SYARAT_HASIL_OFF);
    expect(db.log.rpc).toEqual(["promo_release_enabled:syarat_hasil"]);
  });
  it("released: definitions + the picker / below-HPP flags; branch and date filters apply; stage 3 never plans a waiver", async () => {
    const waiver = rule({ below_hpp: { allowed: true, reason: "barang mendekati expired", ack_by: "u", ack_at: "t" } });
    const db = database([
      sh("b-own"), sh("a-foreign", { branch_ids: ["other"] }), sh("c-future", { valid_from: "2999-01-01" }), sh("d-expired", { valid_until: "2000-01-01" }),
      sh("e-waiver", { rule: waiver }), sh("f-broken", { rule: { discount_mode: "syarat_hasil" } }), sh("g-manual", { auto_apply: false }), sh("h-inactive", { is_active: false }), legacy("legacy"),
    ], { syarat_hasil: true, promo_picker: true, below_hpp: true });
    const r = await loadSyaratHasilKasir(db, "own");
    expect(r).toMatchObject({ released: true, pickerReleased: true, belowHppReleased: true });
    expect(r.defs.map((d) => d.id)).toEqual(["b-own", "e-waiver"]);
    expect(r.defs.every((d) => d.allow_below_hpp === false)).toBe(true);
    expect(r.defs[0]).toMatchObject({ name: "SH b-own", repeat: true, hasil: { items: [{ item_id: "anc", unit: "PCS" }], discount: { type: "nominal", value: 1000 } } });
  });
  it("flag RPC missing (code 42883 / PGRST202) = OFF; any other RPC failure is thrown (fail closed)", async () => {
    for (const code of ["42883", "PGRST202"]) expect(await loadSyaratHasilKasir(database([sh("x")], { syarat_hasil: new Error(code) }), "own")).toEqual(SYARAT_HASIL_OFF);
    await expect(loadSyaratHasilKasir(database([sh("x")], { syarat_hasil: new Error("XX000") }), "own")).rejects.toThrow("Status rilis promo");
  });
  it("an incomplete promo list is a load error, never a silent subset", async () => {
    const failing = { rpc: database([]).rpc, from: () => { const q: Record<string, unknown> = {}; q.select = () => q; q.eq = () => q; q.order = () => q; q.range = async () => ({ data: null, error: { message: "boom" }, count: null }); return q; } };
    await expect(loadSyaratHasilKasir(failing, "own")).rejects.toThrow(/Promo syarat-hasil aktif/);
  });
});

describe("pesanPromoSyaratHasil", () => {
  it("maps database refusals to Indonesian cashier text, hides the code, ignores other errors", () => {
    expect(pesanPromoSyaratHasil("PROMO_SH_NILAI: whole-cart value 10 is below 1 x 500")).toMatch(/^Promo bundling ditolak: Nilai belanja/);
    expect(pesanPromoSyaratHasil("PROMO_SH_TOTAL: refresh quote")).toContain("berubah");
    expect(pesanPromoSyaratHasil("PROMO_SH_SOMETHING_NEW: x")).toContain("aturan promo berubah");
    expect(pesanPromoSyaratHasil("PROMO_SH_NILAI: x")).not.toContain("PROMO_SH");
    expect(pesanPromoSyaratHasil("Harga neto Persediaan di bawah HPP FIFO")).toBeNull();
    expect(pesanPromoSyaratHasil(undefined)).toBeNull();
  });
});
