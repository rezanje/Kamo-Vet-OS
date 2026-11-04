import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// "Tarik item": every app reader of prescription_items that feeds billing, consent, print or history must ignore rows with
// record_withdrawn_at (the DEDICATED Tarik marker). billing_withdrawn_at keeps its rawat-inap meaning ("not billed"): rows
// the rawat-inap cashier removed from the bill (billing_withdrawn_at only) stay in the clinical views exactly as before.
// The fake PostgREST below APPLIES `.is(col, null)` to its rows, so a reader that forgets (or mis-keys) the filter fails.
const state = vi.hoisted(() => ({ rpc: [] as { name: string; args: Record<string, unknown> }[], rpcResult: { data: null as unknown, error: null as null | { code?: string; message: string } }, revalidated: [] as string[],
  user: true, profile: { role: "DOCTOR", is_active: true } as null | { role: string; is_active: boolean }, actor: true as unknown, actorError: null as unknown }));
const ROWS = vi.hoisted(() => [
  { id: "rx-ok", nama_obat: "Obat Dipakai", qty: 1, harga: 30000, jenis: "obat", kategori: "Obat", item_id: "i1", satuan: "pcs", compound_recipe_id: null, service_performers: null, aturan_pakai: "2x1", billing_withdrawn_at: null, record_withdrawn_at: null },
  // Tarik item stamps BOTH markers (not billed + withdrawn from the record).
  { id: "rx-gone", nama_obat: "Obat Ditarik", qty: 1, harga: 35000, jenis: "obat", kategori: "Obat", item_id: "i2", satuan: "pcs", compound_recipe_id: null, service_performers: null, aturan_pakai: "3x1", billing_withdrawn_at: "2026-11-04T10:00:00Z", record_withdrawn_at: "2026-11-04T10:00:00Z" },
  { id: "rx-gone-jasa", nama_obat: "Tindakan Ditarik", qty: 1, harga: 150000, jenis: "jasa", kategori: "Tindakan", item_id: "i3", satuan: "kali", compound_recipe_id: null, service_performers: null, aturan_pakai: null, billing_withdrawn_at: "2026-11-04T10:00:00Z", record_withdrawn_at: "2026-11-04T10:00:00Z" },
  // Rawat-inap cashier 'Hapus item': billing_withdrawn_at ONLY. Must stay visible in clinical views (review blocker).
  { id: "rx-ranap", nama_obat: "Obat Dihapus Kasir Ranap", qty: 1, harga: 20000, jenis: "obat", kategori: "Obat", item_id: "i4", satuan: "pcs", compound_recipe_id: null, service_performers: null, aturan_pakai: "1x1", billing_withdrawn_at: "2026-11-03T10:00:00Z", record_withdrawn_at: null },
]);
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => { state.revalidated.push(path); } }));
vi.mock("next/navigation", () => ({ redirect: (href: string): never => { throw Error(`REDIRECT ${href}`); }, notFound: () => { throw Error("NOT_FOUND"); } }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
vi.mock("@/lib/clinic-record-addenda", () => ({ loadRecordAddenda: async () => ({ state: "ok", rows: [] }), addendumAuthor: () => "" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake() }));
function fake() {
  return {
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
    auth: { getUser: async () => ({ data: { user: state.user ? { id: "actor" } : null } }) },
    rpc: async (name: string, args: Record<string, unknown>) => { state.rpc.push({ name, args }); return name === "clinic_record_correction_actor" ? { data: state.actor, error: state.actorError } : state.rpcResult; },
    from(table: string) {
      const filters: [string, unknown][] = [];
      const rows = () => table === "prescription_items" ? ROWS.filter(r => filters.every(([c, v]) => (v === null ? (r as Record<string, unknown>)[c] == null : true))) : [];
      const query = {
        select() { return query; }, eq() { return query; }, in() { return query; }, order() { return query; }, limit() { return query; }, range() { return query; },
        is(column: string, value: unknown) { filters.push([column, value]); return query; },
        maybeSingle: async () => ({
          data: table === "profiles" ? state.profile : table === "visits" ? { id: "visit", poli: "Poli Umum", dokter: "Drh. Andri", keluhan: "Batuk", status: "Pembayaran", created_at: "2026-11-01T00:00:00Z", pets: { name: "Milo", species: "Kucing" }, customers: { name: "Pemilik" }, branches: { name: "Cabang" } }
            : table === "medical_records" ? { id: "record", diagnosis: "ISPA", penunjang_urls: [] } : null, error: null }),
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: rows(), error: null, count: rows().length }).then(resolve); },
      };
      return query;
    },
  };
}
import { barisTagihanVisit } from "../tagihan-klinik";
import { tarikItemRekamMedis } from "../../app/(app)/klinik/rekam-medis/[visitId]/actions";
import { alasanTarikValid, bisaDitarik, idTarik, pesanTarikGagal, peranBolehTarik, tarikMenghabiskan } from "../tarik-item";
import { loadInpatientHandoff } from "../inpatient-handoff";
import { barisBelumDitagih } from "../tagihan-berjalan";
import Dokumen from "../../app/(app)/klinik/rekam-medis/[visitId]/dokumen/page";
import Resep from "../../app/(app)/klinik/rekam-medis/[visitId]/resep/page";

beforeEach(() => { state.rpc = []; state.revalidated = []; state.rpcResult = { data: null, error: null }; state.user = true; state.profile = { role: "DOCTOR", is_active: true }; state.actor = true; state.actorError = null; });

describe("readers ignore Tarik-withdrawn rows (record_withdrawn_at) and leave rawat-inap cashier rows alone", () => {
  it("Pembayaran cart builder (barisTagihanVisit) drops Tarik rows; a billing_withdrawn-only row is NOT hidden by it (as before)", async () => {
    const lines = await barisTagihanVisit(fake() as never, "visit", "Poli Umum");
    expect(lines.map(l => l.prescription_item_id)).toEqual(["rx-ok", "rx-ranap"]);
  });
  it("printed rekam medis and resep omit withdrawn rows", async () => {
    const dokumen = renderToStaticMarkup(await Dokumen({ params: Promise.resolve({ visitId: "visit" }) }));
    const resep = renderToStaticMarkup(await Resep({ params: Promise.resolve({ visitId: "visit" }) }));
    for (const html of [dokumen, resep]) {
      expect(html).toContain("Obat Dipakai"); expect(html).not.toContain("Obat Ditarik"); expect(html).not.toContain("Tindakan Ditarik");
      expect(html).toContain("Obat Dihapus Kasir Ranap"); // rawat-inap billing removal must not change the printed record retroactively
    }
  });
  // These readers sit in files that need a full page/session harness; assert the exact filter is on THEIR prescription_items query.
  const sources: [string, string][] = [
    ["Pembayaran page cart", "src/app/(app)/klinik/pembayaran/[visitId]/page.tsx"],
    ["Pembayaran consent gate rows", "src/app/(app)/klinik/pembayaran/[visitId]/actions.ts"],
    ["consent gate (gerbangConsent)", "src/lib/tagihan-klinik.ts"],
    ["patient clinical history fallback", "src/lib/patient-clinical-history-server.ts"],
    ["rekam medis page (edit cart + record view)", "src/app/(app)/klinik/rekam-medis/[visitId]/page.tsx"],
    ["resep print", "src/app/(app)/klinik/rekam-medis/[visitId]/resep/page.tsx"],
    ["dokumen print", "src/app/(app)/klinik/rekam-medis/[visitId]/dokumen/page.tsx"],
    ["rawat-inap handoff / evidence list (ObatBiasaEvidence source)", "src/lib/inpatient-handoff.ts"],
    ["cart builder (barisTagihanVisit)", "src/lib/tagihan-klinik.ts"],
  ];
  it.each(sources)("%s reads prescription_items with record_withdrawn_at is null and NEVER keys on billing_withdrawn_at", (_name, file) => {
    const text = readFileSync(file, "utf8");
    // Window of the query chain that starts at each prescription_items read (each file keeps these reads >450 chars apart).
    const reads = [...text.matchAll(/from\(["']prescription_items["']\)/g)].map(m => text.slice(m.index, (m.index ?? 0) + 450));
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) { expect(read).toMatch(/\.is\(["']record_withdrawn_at["'],\s*null\)/); expect(read).not.toMatch(/billing_withdrawn_at/); }
  });
});

describe("helpers", () => {
  const row = (id: string, extra: Record<string, unknown> = {}) => ({ prescription_item_id: id, ...extra });
  it("racikan and unsaved rows are not withdrawable; plain saved rows are", () => {
    expect(bisaDitarik(row("a"))).toBe(true);
    expect(bisaDitarik(row("a", { compound_recipe_id: "r" }))).toBe(false);
    expect(bisaDitarik(row("a", { jenis: "racikan" }))).toBe(false);
    expect(bisaDitarik({})).toBe(false);
  });
  it("package rows expand to the WHOLE saved package, sorted, other packages/rows untouched", () => {
    const cart = [row("b", { package_item_id: "P" }), row("a", { package_item_id: "P" }), row("c", { package_item_id: "Q" }), row("d"), { package_item_id: "P" }];
    expect(idTarik(cart, cart[0])).toEqual(["a", "b"]);
    expect(idTarik(cart, cart[3])).toEqual(["d"]);
    expect(idTarik(cart, { prescription_item_id: "x", compound_recipe_id: "r" })).toEqual([]);
  });
  it("reason 5-200 chars after trim", () => {
    expect(alasanTarikValid("abcd")).toBe(false);
    expect(alasanTarikValid("  abcde ")).toBe(true);
    expect(alasanTarikValid("x".repeat(200))).toBe(true);
    expect(alasanTarikValid("x".repeat(201))).toBe(false);
  });
  it("reason needs >= 5 SIGNIFICANT characters: punctuation, spaces, symbols and zero-width/invisible characters do not count (same rule as the database)", () => {
    const ZW = "\u200b";
    for (const bad of [".....", ZW.repeat(5), "?! - ?! - ?!", "ab" + ZW + "cd" + ZW.repeat(3) + "...", "\t\n\ufeff\u2060\t\n\ufeff\u2060", "\u3164".repeat(6), "$$$$$$", "-----", "\u2026\u2026\u2026\u2026\u2026", "     ", "a b c d", "1 2 3"]) expect(alasanTarikValid(bad), JSON.stringify(bad)).toBe(false);
    for (const good of ["a b c d e", "abc" + ZW + "de", "\u3042\u3044\u3046\u3048\u304a", " 12345!! ", "Salah.", "Dobel input"]) expect(alasanTarikValid(good), JSON.stringify(good)).toBe(true);
  });
  it("length limit counts characters (code points), like the database, not UTF-16 units", () => {
    expect(alasanTarikValid("\u{1F600}".repeat(200) + "")).toBe(false); // 200 emoji: symbols only, no significant text
    expect(alasanTarikValid("\u{10400}".repeat(200))).toBe(true);        // 200 code points (400 UTF-16 units) of letters
    expect(alasanTarikValid("\u{10400}".repeat(201))).toBe(false);
  });
  it("warns when the withdrawal would leave no row in the form (billing then cannot be issued); unsaved new rows count as remaining", () => {
    const cart = [{ prescription_item_id: "a" }, { prescription_item_id: "b" }, {}];
    expect(tarikMenghabiskan(cart, ["a"])).toBe(false);
    expect(tarikMenghabiskan(cart.slice(0, 2), ["a"])).toBe(false);
    expect(tarikMenghabiskan(cart.slice(0, 2), ["a", "b"])).toBe(true);
    expect(tarikMenghabiskan(cart.slice(0, 1), ["a"])).toBe(true);
    expect(tarikMenghabiskan([], ["a"])).toBe(false);
  });
  it("role helper: only an ACTIVE OWNER or DOCTOR may withdraw", () => {
    expect(peranBolehTarik({ role: "OWNER", is_active: true })).toBe(true);
    expect(peranBolehTarik({ role: "DOCTOR", is_active: true })).toBe(true);
    for (const profile of [{ role: "ADMIN", is_active: true }, { role: "STAFF", is_active: true }, { role: "FINANCE", is_active: true }, { role: "DOCTOR", is_active: false }, { role: "OWNER", is_active: false }, { role: "doctor", is_active: true }, null, undefined]) expect(peranBolehTarik(profile)).toBe(false);
  });
  it("database error code prefixes are stripped for users", () => {
    expect(pesanTarikGagal("COMPOUND_LOCKED: Salep adalah racikan; gunakan Aksi")).toBe("Salep adalah racikan; gunakan Aksi");
    expect(pesanTarikGagal("PACKAGE_PARTIAL: paket X hanya dapat ditarik utuh")).toBe("paket X hanya dapat ditarik utuh");
    expect(pesanTarikGagal("IDEMPOTENCY_CONFLICT")).toContain("Muat ulang");
    expect(pesanTarikGagal("")).toContain("belum terkonfirmasi");
  });
});

describe("server action tarikItemRekamMedis", () => {
  const input = { visitId: "visit", recordId: "record", itemIds: ["a", "b"], reason: "  Salah input obat ", requestKey: "tarik-1" };
  it("calls the RPC once with trimmed reason, revalidates billing/print paths and returns the withdrawn ids", async () => {
    state.rpcResult = { data: { withdrawn: ["a", "b"] }, error: null };
    const out = await tarikItemRekamMedis(input);
    expect(out).toEqual({ ok: true, withdrawn: ["a", "b"] });
    // Defense in depth: the branch/role gate is asked BEFORE the withdrawal RPC (the database still decides).
    expect(state.rpc).toEqual([{ name: "clinic_record_correction_actor", args: { p_visit_id: "visit" } }, { name: "clinic_withdraw_record_items", args: { p_visit_id: "visit", p_record_id: "record", p_item_ids: ["a", "b"], p_reason: "Salah input obat", p_request_key: "tarik-1" } }]);
    expect(state.revalidated).toEqual(expect.arrayContaining(["/klinik/pembayaran/visit", "/klinik/rekam-medis/visit", "/klinik/rekam-medis/visit/resep"]));
  });
  it("role gate in the action: ADMIN/STAFF/FINANCE/inactive/no profile/no session never reach the withdrawal RPC", async () => {
    state.rpcResult = { data: { withdrawn: ["a", "b"] }, error: null };
    for (const profile of [{ role: "ADMIN", is_active: true }, { role: "STAFF", is_active: true }, { role: "FINANCE", is_active: true }, { role: "DOCTOR", is_active: false }, null]) {
      state.profile = profile; const out = await tarikItemRekamMedis(input);
      expect(out.ok, JSON.stringify(profile)).toBe(false);
      if (!out.ok) expect(out.error).toContain("pemilik atau dokter");
    }
    state.profile = { role: "DOCTOR", is_active: true }; state.user = false;
    expect((await tarikItemRekamMedis(input)).ok).toBe(false);
    expect(state.rpc.filter(c => c.name === "clinic_withdraw_record_items")).toHaveLength(0);
    expect(state.revalidated).toHaveLength(0);
  });
  it("OWNER passes the gate; a DOCTOR without klinik access to the visit branch (or an unreadable gate) is refused before the withdrawal RPC", async () => {
    state.rpcResult = { data: { withdrawn: ["a", "b"] }, error: null };
    state.profile = { role: "OWNER", is_active: true };
    expect((await tarikItemRekamMedis(input)).ok).toBe(true);
    state.rpc = [];
    for (const [actor, actorError] of [[false, null], [null, null], ["true", null], [true, { message: "boom" }]] as [unknown, unknown][]) {
      state.profile = { role: "DOCTOR", is_active: true }; state.actor = actor; state.actorError = actorError;
      const out = await tarikItemRekamMedis(input);
      expect(out.ok, JSON.stringify([actor, actorError])).toBe(false);
      if (!out.ok) expect(out.error).toContain("akses");
    }
    expect(state.rpc.filter(c => c.name === "clinic_withdraw_record_items")).toHaveLength(0);
  });
  it("never reaches the database for a missing/short reason or empty id list", async () => {
    for (const bad of [{ ...input, reason: "abcd" }, { ...input, reason: "" }, { ...input, reason: "....." }, { ...input, reason: "\u200b".repeat(5) }, { ...input, itemIds: [] }, { ...input, requestKey: "" }]) expect((await tarikItemRekamMedis(bad)).ok).toBe(false);
    expect(state.rpc).toHaveLength(0);
  });
  it("database refusal comes back as a readable error, nothing revalidated", async () => {
    state.rpcResult = { data: null, error: { code: "P0001", message: "COMPOUND_LOCKED: Salep adalah racikan; gunakan Aksi → Ubah komposisi" } };
    expect(await tarikItemRekamMedis(input)).toEqual({ ok: false, error: "Salep adalah racikan; gunakan Aksi → Ubah komposisi" });
    expect(state.revalidated).toHaveLength(0);
  });
  it("a result that does not confirm every id is treated as failure", async () => {
    state.rpcResult = { data: { withdrawn: ["a"] }, error: null };
    expect((await tarikItemRekamMedis(input)).ok).toBe(false);
  });
});

describe("rawat-inap readers: a Tarik-withdrawn drug is never shown as a drug to administer; cashier-withdrawn rows behave as before", () => {
  const rx = (id: string, extra: Record<string, unknown> = {}) => ({ id, medical_record_id: "mr", kategori: "Obat", nama_obat: id, qty: 1, satuan: "pcs", jenis: "obat", aturan_pakai: null, compound_recipe_id: null, created_at: "2026-11-04", billing_withdrawn_at: null, record_withdrawn_at: null, ...extra });
  const rows = [rx("Obat Aktif"), rx("Obat Ditarik Tarik", { billing_withdrawn_at: "2026-11-04T10:00:00Z", record_withdrawn_at: "2026-11-04T10:00:00Z" }), rx("Obat Dihapus Kasir", { billing_withdrawn_at: "2026-11-03T10:00:00Z" })];
  const handoffDb = () => ({ from(table: string) {
    const filters: [string, unknown][] = [];
    const q: Record<string, unknown> = { select: () => q, eq: () => q, in: () => q, order: () => q, range: () => q, maybeSingle: () => q,
      is: (column: string, value: unknown) => { filters.push([column, value]); return q; },
      then(done: (v: unknown) => unknown) {
        const data = table === "visits" ? { id: "visit", dokter: null, keluhan: null } : table === "medical_records" ? [{ id: "mr", visit_id: "visit", created_at: "2026-11-04" }]
          : table === "prescription_items" ? rows.filter(r => filters.every(([c, v]) => v !== null || (r as Record<string, unknown>)[c] == null)) : [];
        return Promise.resolve({ data, count: Array.isArray(data) ? data.length : 1, error: null }).then(done);
      } };
    return q;
  } });
  it("loadInpatientHandoff (feeds HandoffPanel + ObatBiasaEvidence) omits the Tarik row but keeps the cashier-withdrawn row", async () => {
    const result = await loadInpatientHandoff(handoffDb() as never, "visit", "branch");
    expect(result?.prescriptions.map(p => p.nama_obat)).toEqual(["Obat Aktif", "Obat Dihapus Kasir"]);
  });
  it("rawat-inap pending-bill reader (barisBelumDitagih) already excludes a Tarik row (it carries billing_withdrawn_at too)", () => {
    const resep = rows.map(r => ({ ...r, harga: 1000 }));
    expect(barisBelumDitagih(resep as never, [], []).map(r => r.id)).toEqual(["Obat Aktif"]);
  });
});
