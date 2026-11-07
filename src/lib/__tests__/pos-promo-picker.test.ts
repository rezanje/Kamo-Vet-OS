import { describe, expect, it } from "vitest";
import { loadSyaratHasilPerCabang } from "../promo-syarat-hasil-checkout";
import { loadSyaratHasilTampilanPerCabang, pisahTampilanSyaratHasil } from "../pos-promo-picker";

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

describe("loadSyaratHasilTampilanPerCabang (back-office picker display, POS picker)", () => {
  it("no active syarat_hasil promo: undefined and no flag RPC (screen = legacy)", async () => {
    const db = database([legacy("a")], { syarat_hasil: true, promo_picker: true });
    expect(await loadSyaratHasilTampilanPerCabang(db, ["own", "other"])).toBeUndefined();
    expect(db.log.rpc).toEqual([]);
  });
  it("released: per branch the definitions AND whether the promo_picker flag is released; branch filters apply", async () => {
    const db = database([sh("x", { branch_ids: ["own"] })], { syarat_hasil: true, promo_picker: true, below_hpp: false });
    const r = await loadSyaratHasilTampilanPerCabang(db, ["own", "other"]);
    expect(Object.keys(r ?? {})).toEqual(["own"]);
    expect(r?.own.defs.map((d) => d.id)).toEqual(["x"]);
    expect(r?.own.pickerReleased).toBe(true);
  });
  it("promo_picker flag OFF: pickerReleased=false (the screen shows no picker)", async () => {
    const db = database([sh("x")], { syarat_hasil: true, promo_picker: false, below_hpp: false });
    expect((await loadSyaratHasilTampilanPerCabang(db, ["own"]))?.own.pickerReleased).toBe(false);
  });
  it("syarat_hasil flag OFF: undefined even if the picker flag is ON", async () => {
    const db = database([sh("x")], { syarat_hasil: false, promo_picker: true });
    expect(await loadSyaratHasilTampilanPerCabang(db, ["own"])).toBeUndefined();
  });
  it("a failing flag read only hides the preview/picker (the server checkout stays authoritative and fails closed itself)", async () => {
    const db = database([sh("x")], { syarat_hasil: new Error("XX000") });
    expect(await loadSyaratHasilTampilanPerCabang(db, ["own"])).toBeUndefined();
  });
  it("loadSyaratHasilPerCabang (definitions only) is unchanged for the same data", async () => {
    const db = database([sh("x")], { syarat_hasil: true, promo_picker: true, below_hpp: false });
    const old = await loadSyaratHasilPerCabang(db, ["own"]);
    const nu = await loadSyaratHasilTampilanPerCabang(database([sh("x")], { syarat_hasil: true, promo_picker: true, below_hpp: false }), ["own"]);
    expect(old?.own).toEqual(nu?.own.defs);
  });
});

describe("pisahTampilanSyaratHasil (what the POS page hands to PosClient)", () => {
  const def = (id: string) => ({ id }) as never;
  it("undefined in -> both props undefined (the screen is the legacy one)", () => {
    expect(pisahTampilanSyaratHasil(undefined)).toEqual({ syaratHasilPerCabang: undefined, promoPickerPerCabang: undefined });
  });
  it("definitions for every branch; the picker only for branches whose promo_picker flag is released; none released -> undefined (not an empty object)", () => {
    const r = pisahTampilanSyaratHasil({ a: { defs: [def("x")], pickerReleased: true }, b: { defs: [def("y")], pickerReleased: false } });
    expect(r.syaratHasilPerCabang).toEqual({ a: [def("x")], b: [def("y")] });
    expect(r.promoPickerPerCabang).toEqual({ a: true });
    expect(pisahTampilanSyaratHasil({ b: { defs: [def("y")], pickerReleased: false } }).promoPickerPerCabang).toBeUndefined();
  });
});
