// Aksi server "Batalkan tagihan" (B2): hanya memanggil RPC atomik dengan isian tervalidasi; galat diterjemahkan ke bahasa biasa.
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: [] as { name: string; params: Record<string, unknown> }[],
  reply: { data: null as unknown, error: null as { message: string } | null },
  revalidated: [] as string[],
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: async (name: string, params: Record<string, unknown>) => { state.rpc.push({ name, params }); return state.reply; } }) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { state.revalidated.push(p); } }));
import { batalkanTagihanKlinik } from "../actions";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function form(over: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ invoice_id: U(2), visit_id: U(1), reason: "Data percobaan kasir", request_key: "kunci-1", ...over })) f.set(k, v);
  return f;
}
const OK = { status: "VOIDED", void_id: "w1", invoice_id: U(2), invoice_no: "INV-9", visit_id: U(1), original_date: "2026-11-03", tanggal: "2026-11-14", total: 170000,
  dp_converted: 0, advance_id: null, advance_no: null, stock_value: 4000, hpp_reversed: 4000, stock: [], points_delta: 0, withdrawn: 2 };
beforeEach(() => { state.rpc = []; state.reply = { data: null, error: null }; state.revalidated = []; });

it("mengirim tagihan, kunci dan alasan (dirapikan) ke RPC tunggal; sukses me-revalidate dan mengembalikan hasil", async () => {
  state.reply = { data: OK, error: null };
  const r = await batalkanTagihanKlinik(form({ reason: "  Data percobaan kasir  " }));
  expect(r.ok && r.hasil.invoice_no).toBe("INV-9");
  expect(state.rpc).toEqual([{ name: "clinic_void_invoice", params: { p_invoice_id: U(2), p_request_key: "kunci-1", p_reason: "Data percobaan kasir" } }]);
  expect(state.revalidated.length).toBe(1);
});
it("isian tidak valid ditolak di server tanpa memanggil database", async () => {
  for (const f of [form({ invoice_id: "x" }), form({ visit_id: "" }), form({ reason: " a b " }), form({ reason: "x".repeat(501) }), form({ request_key: "" }), form({ request_key: "k".repeat(101) })]) {
    expect((await batalkanTagihanKlinik(f)).ok).toBe(false);
  }
  expect(state.rpc).toEqual([]);
});
it("penolakan database diterjemahkan dan tidak ada revalidate", async () => {
  state.reply = { data: null, error: { message: "BATAL_TAGIHAN_LUNAS: Tagihan ini sudah Lunas. Batalkan penerimaannya dulu." } };
  const r = await batalkanTagihanKlinik(form());
  expect(!r.ok && r.pesan).toBe("Tagihan ini sudah Lunas. Batalkan penerimaannya dulu.");
  state.reply = { data: null, error: { message: "ACCESS_DENIED: hanya Owner" } };
  const r2 = await batalkanTagihanKlinik(form());
  expect(!r2.ok && r2.pesan).toMatch(/Hanya Owner/);
  expect(state.revalidated).toEqual([]);
});
it("jawaban yang tidak sesuai (status lain / tagihan lain / kosong) tidak dianggap sukses", async () => {
  state.reply = { data: { ...OK, status: "OK" }, error: null }; expect((await batalkanTagihanKlinik(form())).ok).toBe(false);
  state.reply = { data: { ...OK, invoice_id: U(9) }, error: null }; expect((await batalkanTagihanKlinik(form())).ok).toBe(false);
  state.reply = { data: null, error: null }; expect((await batalkanTagihanKlinik(form())).ok).toBe(false);
  expect(state.revalidated).toEqual([]);
});
