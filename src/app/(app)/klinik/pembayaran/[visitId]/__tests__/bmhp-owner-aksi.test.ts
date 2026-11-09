// Aksi server "Ubah BMHP (Owner)": muatan ke RPC yang benar untuk dua mode, validasi sebelum menyentuh database,
// pesan galat yang aman, dan tidak ada tulis langsung ke tabel.
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: [] as { name: string; params: Record<string, unknown> }[], result: { data: null as unknown, error: null as { message: string } | null }, revalidated: 0, from: 0 }));
vi.mock("next/cache", () => ({ revalidatePath: () => { state.revalidated += 1; } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: async (name: string, params: Record<string, unknown>) => { state.calls.push({ name, params }); return state.result; },
  from: () => { state.from += 1; throw new Error("tidak boleh menulis/membaca tabel langsung"); },
}) }));
import { pratinjauBmhp, simpanBmhp } from "../bmhp-owner-actions";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function form(over: Record<string, string> = {}) {
  const f = new FormData();
  const base: Record<string, string> = { mode: "pending", visit_id: U(1), record_id: U(2), target_id: U(3), snapshot: "snap-1234567890", reason: "Lacto-B 3,4 sesuai pemakaian", request_key: "kunci-1",
    components: JSON.stringify([{ item_id: U(10), qty: "3,4" }, { item_id: U(11), qty: "" }]), ...over };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
}
beforeEach(() => { state.calls = []; state.revalidated = 0; state.from = 0; state.result = { data: { status: "OK", hpp_before: 60000, hpp_after: 40800, price: 50000, floor_applies: true, price_below_hpp_before: true, price_below_hpp_after: false }, error: null }; });

it("keranjang: pratinjau memanggil clinic_owner_cart_bmhp_quote dengan snapshot dan jumlah 3,4; bahan kosong dikeluarkan; tidak menyimpan", async () => {
  const r = await pratinjauBmhp(form({ reason: "", request_key: "" }));
  expect(r.ok).toBe(true);
  expect(state.calls).toEqual([{ name: "clinic_owner_cart_bmhp_quote", params: { p_record_id: U(2), p_visit_id: U(1), p_prescription_item_id: U(3), p_components: [{ item_id: U(10), qty: 3.4 }], p_snapshot: "snap-1234567890" } }]);
  expect(state.revalidated).toBe(0);
});
it("keranjang: simpan memanggil clinic_owner_correct_cart_bmhp dengan alasan dan kunci, lalu menyegarkan halaman", async () => {
  const r = await simpanBmhp(form());
  expect(r.ok).toBe(true);
  expect(state.calls[0].name).toBe("clinic_owner_correct_cart_bmhp");
  expect(state.calls[0].params).toMatchObject({ p_reason: "Lacto-B 3,4 sesuai pemakaian", p_request_key: "kunci-1", p_snapshot: "snap-1234567890" });
  expect(state.revalidated).toBe(1);
});
it("tagihan: pratinjau dan simpan memakai RPC baris tagihan (tanpa snapshot keranjang)", async () => {
  await pratinjauBmhp(form({ mode: "tagihan", record_id: "", snapshot: "", reason: "", request_key: "" }));
  await simpanBmhp(form({ mode: "tagihan", record_id: "", snapshot: "" }));
  expect(state.calls.map((c) => c.name)).toEqual(["clinic_owner_invoiced_bmhp_quote", "clinic_owner_correct_invoiced_bmhp"]);
  expect(state.calls[0].params).toEqual({ p_invoice_item_id: U(3), p_components: [{ item_id: U(10), qty: 3.4 }] });
  expect(state.calls[1].params).toEqual({ p_invoice_item_id: U(3), p_components: [{ item_id: U(10), qty: 3.4 }], p_reason: "Lacto-B 3,4 sesuai pemakaian", p_request_key: "kunci-1" });
});
it.each([
  ["alasan kosong", { reason: "" }], ["alasan 4 huruf", { reason: "a b c d" }], ["alasan 501 huruf", { reason: "x".repeat(501) }], ["kunci kosong", { request_key: "" }],
  ["target bukan UUID", { target_id: "x" }], ["bahan bukan UUID", { components: JSON.stringify([{ item_id: "x", qty: "1" }]) }], ["JSON rusak", { components: "{" }],
  ["jumlah negatif", { components: JSON.stringify([{ item_id: U(10), qty: "-1" }]) }], ["semua dikeluarkan", { components: JSON.stringify([{ item_id: U(10), qty: "0" }]) }],
  ["bahan ganda", { components: JSON.stringify([{ item_id: U(10), qty: "1" }, { item_id: U(10), qty: "2" }]) }], ["snapshot hilang (keranjang)", { snapshot: "" }],
])("menolak sebelum menyentuh database: %s", async (_label, over) => {
  const r = await simpanBmhp(form(over));
  expect(r.ok).toBe(false);
  expect(state.calls).toEqual([]);
});
it("galat RPC ditampilkan sebagai kalimat sederhana, tanpa menyegarkan halaman", async () => {
  state.result = { data: null, error: { message: "CART_STALE: keranjang sudah berubah\nCONTEXT: PL/pgSQL secret" } };
  const r = await simpanBmhp(form());
  expect(r).toEqual({ ok: false, pesan: expect.stringMatching(/Muat ulang halaman/) });
  expect(JSON.stringify(r)).not.toMatch(/secret|PL\/pgSQL/);
  expect(state.revalidated).toBe(0);
});
it("hasil tanpa status OK tidak dianggap tersimpan", async () => {
  state.result = { data: { status: "NOPE" }, error: null };
  expect((await simpanBmhp(form())).ok).toBe(false);
  expect(state.revalidated).toBe(0);
});
it("hasil ulang (replayed) diteruskan", async () => {
  state.result = { data: { status: "OK", replayed: true, hpp_before: 1, hpp_after: 1, price: 1, floor_applies: false, price_below_hpp_before: false, price_below_hpp_after: false }, error: null };
  const r = await simpanBmhp(form());
  expect(r.ok && r.replayed).toBe(true);
});
it("tidak pernah membaca atau menulis tabel langsung", async () => { await simpanBmhp(form()); await pratinjauBmhp(form()); expect(state.from).toBe(0); });
