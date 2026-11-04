import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const db = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  me: { role: "OWNER", is_active: true } as { role: string; is_active: boolean } | null,
  rpc: [] as { name: string; args: Record<string, unknown> }[],
  rpcError: null as null | { code?: string; message: string },
  readError: null as null | { code?: string; message: string },
  saveData: null as unknown,
  snapshot: null as unknown,
  items: [] as Record<string, unknown>[],
  units: [] as Record<string, unknown>[],
  hpp: [] as Record<string, unknown>[],
  hppFails: false,
  writes: [] as string[],
  reads: [] as string[],
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/promo-paket-hpp", async (orig) => ({ ...(await orig<object>()), loadPaketHpp: async () => { if (db.hppFails) throw new Error("hpp read failed"); return db.hpp; } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.rpc.push({ name, args });
      if (name === "read_promo_edit") return { data: db.snapshot, error: db.readError };
      if (db.rpcError) return { data: null, error: db.rpcError };
      return { data: db.saveData, error: null };
    },
    from(table: string) {
      db.reads.push(table);
      const q: Record<string, unknown> = {};
      for (const m of ["insert", "update", "delete", "upsert"]) q[m] = () => { db.writes.push(`${m} ${table}`); throw new Error(`direct write ${m} ${table}`); };
      q.select = () => q; q.in = () => q; q.eq = () => q; q.order = () => q; q.range = () => q;
      q.maybeSingle = async () => ({ data: db.me });
      q.then = (res: (v: unknown) => unknown) => {
        const rows = table === "items" ? db.items : table === "item_units" ? db.units : [];
        return Promise.resolve({ data: rows, count: rows.length, error: null }).then(res);
      };
      return q;
    },
  }),
}));

import * as actions from "@/app/(app)/crm/promo/paket/actions";
import { paketValuesFromForm, type PaketForm } from "@/lib/promo-paket";

const IKAN = "11111111-1111-4111-8111-111111111111", DONAT = "22222222-2222-4222-8222-222222222222", ANC = "33333333-3333-4333-8333-333333333333";
const PID = "55555555-5555-4555-8555-555555555555", V1 = "a".repeat(32), V2 = "b".repeat(32);
const form = (over: Partial<PaketForm> = {}): PaketForm => ({
  name: "Beli 2 Bolt, ANC -Rp1.000", branchIds: [], validFrom: "2026-11-04", validUntil: "", repeat: true,
  syarat: [{ kind: "qty", min: "2", items: [{ item_id: IKAN, unit: "PCS" }, { item_id: DONAT, unit: "PCS" }] }],
  hasil: { items: [{ item_id: ANC, unit: "PCS" }], rewardQty: "1", discountType: "nominal", value: "1000", maxAmount: "" },
  belowHpp: { allowed: false, reason: "" }, ...over,
});
const savedSnapshot = (active = false, version = V2) => ({ version, item_ids: [], promo: { id: PID, is_active: active } });
const snapOf = (f: PaketForm, active = false) => {
  const v = paketValuesFromForm(f, "x");
  return { version: V1, item_ids: [], promo: { id: PID, name: f.name, promo_type: "bundling", is_active: active, branch_ids: [], valid_from: "2026-11-04", valid_until: null,
    rule: { discount_mode: "syarat_hasil", syarat_hasil: { version: 1, repeat: true, syarat: v.syarat, hasil: v.hasil, below_hpp: f.belowHpp.allowed ? { allowed: true, reason: f.belowHpp.reason, ack_by: "u", ack_at: "t" } : { allowed: false } } } } };
};
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-04T03:00:00Z"));
  Object.assign(db, { user: { id: "u1" }, me: { role: "OWNER", is_active: true }, rpc: [], rpcError: null, readError: null, saveData: savedSnapshot(), snapshot: snapOf(form()), hpp: [], hppFails: false, writes: [], reads: [] });
  db.items = [{ id: IKAN, code: "B1", name: "Bolt Ikan", unit: "PCS", is_active: true, item_type: "Persediaan" }, { id: DONAT, code: "B2", name: "Bolt Donat", unit: "PCS", is_active: true, item_type: "Persediaan" }, { id: ANC, code: "A1", name: "ANC Creamy Stick", unit: "PCS", is_active: true, item_type: "Persediaan" }];
  db.units = [];
});

describe("simpanPromoPaket", () => {
  it("creates through save_promo_syarat_hasil only: p_id null, no token, exactly the nine keys, server-built suggest", async () => {
    const r = await actions.simpanPromoPaket({ id: null, version: null, form: form() });
    expect(r).toEqual({ ok: true, id: PID, version: V2, active: false });
    expect(db.rpc).toHaveLength(1);
    expect(db.rpc[0].name).toBe("save_promo_syarat_hasil");
    expect(db.rpc[0].args).toMatchObject({ p_id: null, p_expected_version: null });
    const values = db.rpc[0].args.p_values as Record<string, unknown>;
    expect(Object.keys(values).sort()).toEqual(["below_hpp", "branch_ids", "hasil", "name", "repeat", "suggest", "syarat", "valid_from", "valid_until"]);
    expect(values.suggest).toContain("potongan Rp1.000 per PCS ANC Creamy Stick");
    expect(db.writes).toEqual([]);
  });
  it("edits with the stale-version token the page was opened with", async () => {
    await actions.simpanPromoPaket({ id: PID, version: V1, form: form() });
    expect(db.rpc[0].args).toMatchObject({ p_id: PID, p_expected_version: V1 });
  });
  it("a stale token comes back as stale:true with the reload prompt, and nothing else is written", async () => {
    db.rpcError = { code: "40001", message: "PROMO_EDIT_CONFLICT: Promo sudah berubah." };
    const r = await actions.simpanPromoPaket({ id: PID, version: V1, form: form() });
    expect(r).toMatchObject({ ok: false, stale: true, message: expect.stringContaining("diubah orang lain") });
    expect(db.rpc).toHaveLength(1);
  });
  it("role gate: STAFF, deactivated OWNER, unknown profile and anonymous are refused before any RPC", async () => {
    for (const [me, user] of [[{ role: "STAFF", is_active: true }, { id: "u" }], [{ role: "OWNER", is_active: false }, { id: "u" }], [null, { id: "u" }], [{ role: "OWNER", is_active: true }, null]] as const) {
      db.me = me as never; db.user = user as never;
      expect(await actions.simpanPromoPaket({ id: null, version: null, form: form() })).toEqual({ ok: false, message: "Hanya Owner/Admin aktif yang bisa mengatur promo." });
    }
    expect(db.rpc).toEqual([]);
  });
  it("ADMIN may save but never the below-HPP waiver (refused before the RPC); OWNER may, and only allowed+reason are sent", async () => {
    const waiver = form({ belowHpp: { allowed: true, reason: "barang reject sisa gudang" } });
    db.me = { role: "ADMIN", is_active: true };
    expect(await actions.simpanPromoPaket({ id: null, version: null, form: waiver })).toMatchObject({ ok: false, message: expect.stringContaining("Hanya Owner") });
    expect(db.rpc).toEqual([]);
    expect(await actions.simpanPromoPaket({ id: null, version: null, form: form() })).toMatchObject({ ok: true });
    db.rpc = []; db.me = { role: "OWNER", is_active: true };
    expect(await actions.simpanPromoPaket({ id: null, version: null, form: waiver })).toMatchObject({ ok: true });
    expect((db.rpc[0].args.p_values as { below_hpp: unknown }).below_hpp).toEqual({ allowed: true, reason: "barang reject sisa gudang" });
  });
  it("revalidates the input on the server (forged client form): Indonesian messages, no RPC", async () => {
    const r = await actions.simpanPromoPaket({ id: null, version: null, form: form({ syarat: [{ kind: "qty", min: "-1", items: [{ item_id: IKAN, unit: "PCS" }] }] }) });
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("kuantitas minimum harus bilangan bulat") });
    db.items[0].is_active = false;
    expect(await actions.simpanPromoPaket({ id: null, version: null, form: form() })).toMatchObject({ ok: false, message: expect.stringContaining("tidak aktif") });
    db.items[0].item_type = "Jasa"; db.items[0].is_active = true;
    expect(await actions.simpanPromoPaket({ id: null, version: null, form: form() })).toMatchObject({ ok: false });
    expect(await actions.simpanPromoPaket({ id: null, version: null, form: { nonsense: 1 } })).toMatchObject({ ok: false, message: expect.stringContaining("Muat ulang") });
    expect(db.rpc).toEqual([]);
  });
  it("rejects malformed ids / tokens and ignores extra properties smuggled into the form (is_active, actor)", async () => {
    expect(await actions.simpanPromoPaket({ id: "not-a-uuid", version: V1, form: form() })).toMatchObject({ ok: false });
    expect(await actions.simpanPromoPaket({ id: PID, version: "zzz", form: form() })).toMatchObject({ ok: false });
    expect(await actions.simpanPromoPaket({ id: PID, version: null, form: form() })).toMatchObject({ ok: false });
    expect(db.rpc).toEqual([]);
    await actions.simpanPromoPaket({ id: null, version: null, form: { ...form(), is_active: true, actor_id: "spoof" } });
    const values = db.rpc[0].args.p_values as Record<string, unknown>;
    expect(values).not.toHaveProperty("is_active");
    expect(values).not.toHaveProperty("actor_id");
  });
  it("database refusals are mapped to readable Indonesian", async () => {
    db.rpcError = { code: "55000", message: "PROMO_SH_ACTIVE_EDIT: nonaktifkan promo dulu" };
    expect(await actions.simpanPromoPaket({ id: PID, version: V1, form: form() })).toEqual({ ok: false, message: "Promo sedang aktif. Nonaktifkan dulu sebelum mengubah isinya." });
    db.rpcError = { code: "42501", message: "PROMO_SH_OWNER_ONLY: x" };
    expect(await actions.simpanPromoPaket({ id: PID, version: V1, form: form() })).toMatchObject({ ok: false, message: "Hanya Owner yang boleh mengizinkan penjualan di bawah HPP." });
  });
});

describe("simpanPromoPaket — units, size gate before master reads, UUID branches", () => {
  it("the generated suggest text carries the unit chosen per item ('Beli 2 DUS Bolt Ikan', 'potongan Rp1.000 per PCS ANC Creamy Stick')", async () => {
    db.units = [{ id: "u1", item_id: IKAN, unit: "DUS" }];
    const f = form({ syarat: [{ kind: "qty", min: "2", items: [{ item_id: IKAN, unit: "DUS" }] }] });
    expect((await actions.simpanPromoPaket({ id: null, version: null, form: f })).ok).toBe(true);
    const suggest = (db.rpc[0].args.p_values as { suggest: string }).suggest;
    expect(suggest).toContain("Beli 2 DUS Bolt Ikan");
    expect(suggest).toContain("potongan Rp1.000 per PCS ANC Creamy Stick");
  });
  const refs = (n: number) => Array.from({ length: n }, (_, i) => ({ item_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, unit: "PCS" }));
  it("an oversize payload (50 rows x 200 refs, 51 items in a row, 21 reward items) is refused with a friendly message BEFORE any master read or RPC", async () => {
    const huge = form({ syarat: Array.from({ length: 50 }, () => ({ kind: "qty" as const, min: "1", items: refs(200) })) });
    const r = await actions.simpanPromoPaket({ id: null, version: null, form: huge });
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("Syarat promo maksimal 8 baris.") });
    expect(db.reads.filter((t) => t !== "profiles")).toEqual([]);
    for (const f of [form({ syarat: [{ kind: "qty", min: "1", items: refs(51) }] }), form({ hasil: { ...form().hasil, items: refs(21) } })]) {
      expect(await actions.simpanPromoPaket({ id: null, version: null, form: f })).toMatchObject({ ok: false, message: expect.stringMatching(/maksimal (50|20) barang/) });
    }
    expect(db.reads.filter((t) => t !== "profiles")).toEqual([]);
    expect(db.rpc).toEqual([]);
  });
  it("branch ids that are not UUIDs get a friendly Indonesian error: no raw cast error, no master read, no RPC", async () => {
    const r = await actions.simpanPromoPaket({ id: null, version: null, form: form({ branchIds: ["not-a-uuid", "x'--"] }) });
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("Cabang tidak valid") });
    expect(r.ok === false && r.message).not.toMatch(/invalid input syntax|uuid/i);
    expect(db.reads.filter((t) => t !== "profiles")).toEqual([]);
    expect(db.rpc).toEqual([]);
  });
  it("an expired promo refused by the database on save/activation reads cleanly (no 'Gagal menyimpan promo:' prefix)", async () => {
    db.rpcError = { code: "23514", message: 'KADALUARSA: Promo "x" berakhir 2026-10-13 dan sudah lewat. Perpanjang dulu tanggal "Berlaku s/d" sebelum diaktifkan kembali.' };
    const r = await actions.ubahStatusPromoPaket({ id: PID, version: V1, active: true });
    expect(r).toEqual({ ok: false, message: 'Promo "x" berakhir 2026-10-13 dan sudah lewat. Perpanjang dulu tanggal "Berlaku s/d" sebelum diaktifkan kembali.' });
  });
});

describe("ubahStatusPromoPaket", () => {
  it("activates through set_promo_syarat_hasil_active with the version token", async () => {
    db.saveData = savedSnapshot(true, V2);
    expect(await actions.ubahStatusPromoPaket({ id: PID, version: V1, active: true })).toEqual({ ok: true, id: PID, version: V2, active: true });
    expect(db.rpc.at(-1)).toEqual({ name: "set_promo_syarat_hasil_active", args: { p_id: PID, p_expected_version: V1, p_active: true } });
    expect(db.writes).toEqual([]);
  });
  it("release flag OFF: the database refusal becomes the 'belum dirilis oleh Owner' message", async () => {
    db.rpcError = { code: "55000", message: "PROMO_SH_RELEASE: promo Syarat-Hasil belum dirilis" };
    const r = await actions.ubahStatusPromoPaket({ id: PID, version: V1, active: true });
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("Fitur promo paket belum dirilis oleh Owner") });
  });
  it("stale token → stale:true", async () => {
    db.rpcError = { code: "40001", message: "PROMO_EDIT_CONFLICT" };
    expect(await actions.ubahStatusPromoPaket({ id: PID, version: V1, active: false })).toMatchObject({ ok: false, stale: true });
  });
  it("deactivating never reads HPP and is allowed for ADMIN", async () => {
    db.me = { role: "ADMIN", is_active: true }; db.hppFails = true; db.saveData = savedSnapshot(false, V2);
    expect(await actions.ubahStatusPromoPaket({ id: PID, version: V1, active: false })).toMatchObject({ ok: true, active: false });
  });
  it("role gate", async () => {
    db.me = { role: "STAFF", is_active: true };
    expect(await actions.ubahStatusPromoPaket({ id: PID, version: V1, active: true })).toMatchObject({ ok: false });
    expect(db.rpc).toEqual([]);
  });
  const LAYER = { item_id: ANC, unit: "PCS", price: 15000, hpp: 14500, source: "lapisan" as const };
  it("RELIABLE estimate (real retail stock-layer cost, branch price) below HPP and no Owner waiver: activation is BLOCKED before the set RPC (Andri 5.1)", async () => {
    db.hpp = [LAYER];
    for (const role of ["OWNER", "ADMIN"]) {
      db.me = { role, is_active: true }; db.rpc = [];
      const r = await actions.ubahStatusPromoPaket({ id: PID, version: V1, active: true });
      expect(r).toMatchObject({ ok: false, message: expect.stringContaining("perkiraan di bawah modal") });
      expect(r.ok === false && r.message).toContain("perlu izin Owner");
      expect(r.ok === false && r.message).toContain("Rp500/unit");
      expect(db.rpc.map((c) => c.name)).toEqual(["read_promo_edit"]);
    }
  });
  it("FALLBACK estimate (master buy price, no stock layer) below HPP is only a warning: activation proceeds with the warning, for OWNER and ADMIN", async () => {
    db.hpp = [{ ...LAYER, source: "harga_beli" as never }];
    db.saveData = savedSnapshot(true, V2);
    for (const role of ["OWNER", "ADMIN"]) {
      db.me = { role, is_active: true }; db.rpc = [];
      const r = await actions.ubahStatusPromoPaket({ id: PID, version: V1, active: true });
      expect(r).toMatchObject({ ok: true, id: PID, version: V2, active: true, warning: expect.stringContaining("perkiraan di bawah modal") });
      expect(r.ok && r.warning).toContain("perlu izin Owner");
      expect(db.rpc.map((c) => c.name)).toEqual(["read_promo_edit", "set_promo_syarat_hasil_active"]);
    }
  });
  it("no warning with the waiver, with unknown HPP, or when the price stays above HPP", async () => {
    db.saveData = savedSnapshot(true, V2);
    db.hpp = [{ item_id: ANC, unit: "PCS", price: 15000, hpp: 14500, source: "lapisan" }];
    db.snapshot = snapOf(form({ belowHpp: { allowed: true, reason: "barang reject sisa gudang" } }));
    expect(await actions.ubahStatusPromoPaket({ id: PID, version: V1, active: true })).toEqual({ ok: true, id: PID, version: V2, active: true });
    db.snapshot = snapOf(form()); db.hpp = [{ item_id: ANC, unit: "PCS", price: 15000, hpp: null, source: null }];
    expect(await actions.ubahStatusPromoPaket({ id: PID, version: V1, active: true })).toEqual({ ok: true, id: PID, version: V2, active: true });
    db.hpp = [{ item_id: ANC, unit: "PCS", price: 20000, hpp: 14500, source: "lapisan" }];
    expect(await actions.ubahStatusPromoPaket({ id: PID, version: V1, active: true })).toEqual({ ok: true, id: PID, version: V2, active: true });
  });
  it("several branch rows: the message names the worst case", async () => {
    db.hpp = [{ item_id: ANC, unit: "PCS", price: 15000, hpp: 14500, source: "lapisan", branch_ids: ["a"] }, { item_id: ANC, unit: "PCS", price: 15000, hpp: 15900, source: "lapisan", branch_ids: ["b"] }];
    const r = await actions.ubahStatusPromoPaket({ id: PID, version: V1, active: true });
    expect(r.ok === false && r.message).toContain("Rp1.900/unit");
  });
  it("an unreadable HPP never silently allows nor crashes: activation continues to the database, which stays the authority", async () => {
    db.hppFails = true;
    expect(await actions.ubahStatusPromoPaket({ id: PID, version: V1, active: true })).toMatchObject({ ok: true });
  });
});

describe("ubahStatusPaketDariDaftar (list button) — Edit/Aktifkan/Nonaktifkan only", () => {
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  const go = (o: Record<string, string>) => actions.ubahStatusPaketDariDaftar(fd(o)).then(() => "no-redirect", (e: Error) => e.message);
  it("toggles with the version read now, and redirects with a success marker", async () => {
    expect(await go({ id: PID, active: "1", was: "0" })).toBe("REDIRECT /crm/promo?success=paket-aktif");
    expect(db.rpc.map((c) => c.name)).toEqual(["read_promo_edit", "set_promo_syarat_hasil_active"]);
    expect(db.rpc[1].args).toEqual({ p_id: PID, p_expected_version: V1, p_active: true });
    db.rpc = []; db.snapshot = snapOf(form(), true);
    expect(await go({ id: PID, active: "0", was: "1" })).toBe("REDIRECT /crm/promo?success=paket-nonaktif");
  });
  it("reliable below-HPP estimate from the list: refused with the message in the redirect, set RPC never called", async () => {
    db.hpp = [{ item_id: ANC, unit: "PCS", price: 15000, hpp: 14500, source: "lapisan" }];
    expect(decodeURIComponent(await go({ id: PID, active: "1", was: "0" }))).toContain("perkiraan di bawah modal");
    expect(db.rpc.map((c) => c.name)).toEqual(["read_promo_edit"]);
  });
  it("fallback below-HPP estimate from the list: activation succeeds, redirecting with the warning variant of the success marker", async () => {
    db.hpp = [{ item_id: ANC, unit: "PCS", price: 15000, hpp: 14500, source: "harga_beli" }];
    expect(await go({ id: PID, active: "1", was: "0" })).toBe("REDIRECT /crm/promo?success=paket-aktif-peringatan");
    expect(db.rpc.map((c) => c.name)).toEqual(["read_promo_edit", "set_promo_syarat_hasil_active"]);
  });
  it("the state the list showed no longer matches → refused with a readable message", async () => {
    db.snapshot = snapOf(form(), true);
    const url = await go({ id: PID, active: "1", was: "0" });
    expect(decodeURIComponent(url)).toContain("Status promo sudah berubah");
    expect(db.rpc.map((c) => c.name)).toEqual(["read_promo_edit"]);
  });
  it("release OFF is explained in the redirect message", async () => {
    db.rpcError = { code: "55000", message: "PROMO_SH_RELEASE: promo Syarat-Hasil belum dirilis" };
    expect(decodeURIComponent(await go({ id: PID, active: "1", was: "0" }))).toContain("Fitur promo paket belum dirilis oleh Owner");
  });
  it("non-managers are refused and bad ids / unreadable promos never reach the set RPC", async () => {
    db.me = { role: "STAFF", is_active: true };
    expect(decodeURIComponent(await go({ id: PID, active: "1", was: "0" }))).toContain("Hanya Owner/Admin");
    db.me = { role: "ADMIN", is_active: true };
    expect(decodeURIComponent(await go({ id: "x", active: "1", was: "0" }))).toContain("Promo tidak valid");
    db.readError = { code: "42501", message: "Promo tidak ditemukan atau tidak dapat diakses" };
    expect(decodeURIComponent(await go({ id: PID, active: "1", was: "0" }))).toContain("Promo tidak ditemukan");
    expect(db.rpc.filter((c) => c.name !== "read_promo_edit")).toEqual([]);
  });
});

describe("salinPromoPaket / salinPromoPaketDariDaftar — 'Salin promo' (Andri 5.2)", () => {
  const withWaiver = () => snapOf(form({ name: "Beli 2 Bolt", branchIds: [], validUntil: "2026-11-30", belowHpp: { allowed: true, reason: "barang reject sisa gudang" } }), true);
  it("creates a NEW inactive draft through save_promo_syarat_hasil with p_id null: 'Salinan dari <nama>', same syarat/hasil/branches, waiver NOT copied, dates restarted; works for an ACTIVE source", async () => {
    db.snapshot = withWaiver();
    const r = await actions.salinPromoPaket({ id: PID });
    expect(r).toEqual({ ok: true, id: PID, version: V2, active: false });
    expect(db.rpc.map((c) => c.name)).toEqual(["read_promo_edit", "save_promo_syarat_hasil"]);
    expect(db.rpc[1].args).toMatchObject({ p_id: null, p_expected_version: null });
    const v = db.rpc[1].args.p_values as Record<string, unknown>;
    expect(Object.keys(v).sort()).toEqual(["below_hpp", "branch_ids", "hasil", "name", "repeat", "suggest", "syarat", "valid_from", "valid_until"]);
    expect(v.name).toBe("Salinan dari Beli 2 Bolt");
    expect(v.below_hpp).toEqual({ allowed: false });
    expect(v.valid_from).toBe("2026-11-04");
    expect(v.valid_until).toBeNull();
    expect(v.syarat).toEqual(paketValuesFromForm(form(), "x").syarat);
    expect(v.hasil).toEqual(paketValuesFromForm(form(), "x").hasil);
    expect(v.suggest).toContain("potongan Rp1.000 per PCS ANC Creamy Stick");
    expect(db.writes).toEqual([]);
  });
  it("a long source name is cut so the copy name stays within 120 characters", async () => {
    db.snapshot = snapOf(form({ name: "N".repeat(120) }));
    await actions.salinPromoPaket({ id: PID });
    expect(((db.rpc[1].args.p_values as { name: string }).name).length).toBeLessThanOrEqual(120);
    expect((db.rpc[1].args.p_values as { name: string }).name.startsWith("Salinan dari ")).toBe(true);
  });
  it("OWNER and ADMIN only; STAFF/anonymous/bad id are refused before any read; legacy promos and unreadable promos give a friendly message and never save", async () => {
    db.me = { role: "STAFF", is_active: true };
    expect(await actions.salinPromoPaket({ id: PID })).toMatchObject({ ok: false, message: "Hanya Owner/Admin aktif yang bisa mengatur promo." });
    db.me = { role: "ADMIN", is_active: true };
    expect(await actions.salinPromoPaket({ id: "nope" })).toMatchObject({ ok: false });
    expect(db.rpc).toEqual([]);
    expect(await actions.salinPromoPaket({ id: PID })).toMatchObject({ ok: true });
    db.rpc = []; db.snapshot = { version: V1, item_ids: [], promo: { id: PID, name: "Lama", is_active: false, rule: { suggest: "x" }, branch_ids: [] } };
    expect(await actions.salinPromoPaket({ id: PID })).toMatchObject({ ok: false, message: expect.stringContaining("bukan promo paket") });
    db.rpc = []; db.readError = { code: "42501", message: "Promo tidak ditemukan atau tidak dapat diakses" };
    expect(await actions.salinPromoPaket({ id: PID })).toMatchObject({ ok: false, message: expect.stringContaining("Promo tidak ditemukan") });
    expect(db.rpc.map((c) => c.name)).toEqual(["read_promo_edit"]);
  });
  it("a source whose item became inactive cannot be copied silently: the validator's Indonesian message, no save", async () => {
    db.snapshot = snapOf(form()); db.items[2].is_active = false;
    expect(await actions.salinPromoPaket({ id: PID })).toMatchObject({ ok: false, message: expect.stringContaining("tidak aktif") });
    expect(db.rpc.map((c) => c.name)).toEqual(["read_promo_edit"]);
  });
  it("the list button redirects to the new draft's editor; failures redirect back with the message", async () => {
    db.snapshot = snapOf(form());
    const f = new FormData(); f.set("id", PID);
    await expect(actions.salinPromoPaketDariDaftar(f)).rejects.toThrow(`REDIRECT /crm/promo/paket/${PID}?salinan=1`);
    db.me = { role: "STAFF", is_active: true };
    await expect(actions.salinPromoPaketDariDaftar(f)).rejects.toThrow(/REDIRECT \/crm\/promo\?error=/);
  });
});

describe("taksirHppPaket", () => {
  it("is behind the same gate and returns the rows (read-only)", async () => {
    db.hpp = [{ item_id: ANC, unit: "PCS", price: 15000, hpp: 14500, source: "lapisan" }];
    expect(await actions.taksirHppPaket([{ item_id: ANC, unit: "PCS" }], [])).toEqual({ ok: true, rows: db.hpp });
    db.me = { role: "STAFF", is_active: true };
    expect(await actions.taksirHppPaket([{ item_id: ANC, unit: "PCS" }], [])).toMatchObject({ ok: false });
    db.me = { role: "ADMIN", is_active: true };
    expect(await actions.taksirHppPaket("nope", [])).toMatchObject({ ok: false });
  });
  it("refuses oversize / non-UUID branch id lists before reading anything", async () => {
    const many = Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await actions.taksirHppPaket([{ item_id: ANC, unit: "PCS" }], many)).toMatchObject({ ok: false });
    expect(await actions.taksirHppPaket([{ item_id: ANC, unit: "PCS" }], ["nope"])).toMatchObject({ ok: false });
  });
});

describe("no delete (deactivate only)", () => {
  it("the actions module exports no delete/remove capability and the source never deletes", () => {
    expect(Object.keys(actions).sort()).toEqual(["salinPromoPaket", "salinPromoPaketDariDaftar", "simpanPromoPaket", "taksirHppPaket", "ubahStatusPaketDariDaftar", "ubahStatusPromoPaket"]);
    const src = readFileSync("src/app/(app)/crm/promo/paket/actions.ts", "utf8");
    expect(src).not.toMatch(/\.delete\(/);
    expect(src).not.toMatch(/\.(insert|update|upsert)\(/);
    expect(src).not.toMatch(/from\(["']promos["']\)/);
    expect(src).not.toMatch(/from\(["']promo_items["']\)/);
  });
});
