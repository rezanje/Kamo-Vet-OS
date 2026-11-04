import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// "Tarik item": every app reader of prescription_items that feeds billing, consent, print or history must
// ignore rows with billing_withdrawn_at. The fake PostgREST below APPLIES `.is(col, null)` to its rows, so a reader
// that forgets the filter returns the withdrawn row and the test fails.
const state = vi.hoisted(() => ({ rpc: [] as { name: string; args: Record<string, unknown> }[], rpcResult: { data: null as unknown, error: null as null | { code?: string; message: string } }, revalidated: [] as string[] }));
const ROWS = vi.hoisted(() => [
  { id: "rx-ok", nama_obat: "Obat Dipakai", qty: 1, harga: 30000, jenis: "obat", kategori: "Obat", item_id: "i1", satuan: "pcs", compound_recipe_id: null, service_performers: null, aturan_pakai: "2x1", billing_withdrawn_at: null },
  { id: "rx-gone", nama_obat: "Obat Ditarik", qty: 1, harga: 35000, jenis: "obat", kategori: "Obat", item_id: "i2", satuan: "pcs", compound_recipe_id: null, service_performers: null, aturan_pakai: "3x1", billing_withdrawn_at: "2026-11-04T10:00:00Z" },
  { id: "rx-gone-jasa", nama_obat: "Tindakan Ditarik", qty: 1, harga: 150000, jenis: "jasa", kategori: "Tindakan", item_id: "i3", satuan: "kali", compound_recipe_id: null, service_performers: null, aturan_pakai: null, billing_withdrawn_at: "2026-11-04T10:00:00Z" },
]);
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => { state.revalidated.push(path); } }));
vi.mock("next/navigation", () => ({ redirect: (href: string): never => { throw Error(`REDIRECT ${href}`); }, notFound: () => { throw Error("NOT_FOUND"); } }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
vi.mock("@/lib/clinic-record-addenda", () => ({ loadRecordAddenda: async () => ({ state: "ok", rows: [] }), addendumAuthor: () => "" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake() }));
function fake() {
  return {
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
    rpc: async (name: string, args: Record<string, unknown>) => { state.rpc.push({ name, args }); return state.rpcResult; },
    from(table: string) {
      const filters: [string, unknown][] = [];
      const rows = () => table === "prescription_items" ? ROWS.filter(r => filters.every(([c, v]) => (v === null ? (r as Record<string, unknown>)[c] == null : true))) : [];
      const query = {
        select() { return query; }, eq() { return query; }, in() { return query; }, order() { return query; }, limit() { return query; }, range() { return query; },
        is(column: string, value: unknown) { filters.push([column, value]); return query; },
        maybeSingle: async () => ({
          data: table === "visits" ? { id: "visit", poli: "Poli Umum", dokter: "Drh. Andri", keluhan: "Batuk", status: "Pembayaran", created_at: "2026-11-01T00:00:00Z", pets: { name: "Milo", species: "Kucing" }, customers: { name: "Pemilik" }, branches: { name: "Cabang" } }
            : table === "medical_records" ? { id: "record", diagnosis: "ISPA", penunjang_urls: [] } : null, error: null }),
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: rows(), error: null, count: rows().length }).then(resolve); },
      };
      return query;
    },
  };
}
import { barisTagihanVisit } from "../tagihan-klinik";
import { tarikItemRekamMedis } from "../../app/(app)/klinik/rekam-medis/[visitId]/actions";
import { alasanTarikValid, bisaDitarik, idTarik, pesanTarikGagal } from "../tarik-item";
import Dokumen from "../../app/(app)/klinik/rekam-medis/[visitId]/dokumen/page";
import Resep from "../../app/(app)/klinik/rekam-medis/[visitId]/resep/page";

beforeEach(() => { state.rpc = []; state.revalidated = []; state.rpcResult = { data: null, error: null }; });

describe("readers ignore withdrawn rows", () => {
  it("Pembayaran cart builder (barisTagihanVisit) lists only rows that are not withdrawn", async () => {
    const lines = await barisTagihanVisit(fake() as never, "visit", "Poli Umum");
    expect(lines.map(l => l.prescription_item_id)).toEqual(["rx-ok"]);
  });
  it("printed rekam medis and resep omit withdrawn rows", async () => {
    const dokumen = renderToStaticMarkup(await Dokumen({ params: Promise.resolve({ visitId: "visit" }) }));
    const resep = renderToStaticMarkup(await Resep({ params: Promise.resolve({ visitId: "visit" }) }));
    for (const html of [dokumen, resep]) { expect(html).toContain("Obat Dipakai"); expect(html).not.toContain("Obat Ditarik"); expect(html).not.toContain("Tindakan Ditarik"); }
  });
  // These readers sit in files that need a full page/session harness; assert the exact filter is on THEIR prescription_items query.
  const sources: [string, string][] = [
    ["Pembayaran page cart", "src/app/(app)/klinik/pembayaran/[visitId]/page.tsx"],
    ["Pembayaran consent gate rows", "src/app/(app)/klinik/pembayaran/[visitId]/actions.ts"],
    ["consent gate (gerbangConsent)", "src/lib/tagihan-klinik.ts"],
    ["patient clinical history fallback", "src/lib/patient-clinical-history-server.ts"],
    ["rekam medis page (edit cart + record view)", "src/app/(app)/klinik/rekam-medis/[visitId]/page.tsx"],
  ];
  it.each(sources)("%s reads prescription_items with billing_withdrawn_at is null", (_name, file) => {
    const text = readFileSync(file, "utf8");
    // Window of the query chain that starts at each prescription_items read (each file keeps these reads >450 chars apart).
    const reads = [...text.matchAll(/from\(["']prescription_items["']\)/g)].map(m => text.slice(m.index, (m.index ?? 0) + 450));
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) expect(read).toMatch(/\.is\(["']billing_withdrawn_at["'],\s*null\)/);
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
    expect(state.rpc).toEqual([{ name: "clinic_withdraw_record_items", args: { p_visit_id: "visit", p_record_id: "record", p_item_ids: ["a", "b"], p_reason: "Salah input obat", p_request_key: "tarik-1" } }]);
    expect(state.revalidated).toEqual(expect.arrayContaining(["/klinik/pembayaran/visit", "/klinik/rekam-medis/visit", "/klinik/rekam-medis/visit/resep"]));
  });
  it("never reaches the database for a missing/short reason or empty id list", async () => {
    for (const bad of [{ ...input, reason: "abcd" }, { ...input, reason: "" }, { ...input, itemIds: [] }, { ...input, requestKey: "" }]) expect((await tarikItemRekamMedis(bad)).ok).toBe(false);
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
