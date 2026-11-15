// Aksi server "Batalkan penerimaan": hanya memanggil RPC atomik dengan isian tervalidasi; galat diterjemahkan ke Indonesia.
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: [] as { name: string; params: Record<string, unknown> }[],
  reply: { data: null as unknown, error: null as { message: string } | null },
  revalidated: [] as string[],
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: async (name: string, params: Record<string, unknown>) => { state.rpc.push({ name, params }); return state.reply; } }) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { state.revalidated.push(p); } }));
import { batalkanPenerimaanKlinik } from "../actions";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function form(over: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ invoice_id: U(2), visit_id: U(1), reason: "Harga vaksin salah, disetujui pemilik", request_key: "kunci-1", ...over })) f.set(k, v);
  return f;
}
const OK = { status: "CANCELLED", cancellation_id: "c1", invoice_id: U(2), invoice_no: "INV-9", paid_status: "Belum Lunas", amount: 175000, direct_amount: 175000, cash_amount: 0, shift_mode: "nonkas", receipts: [], other_invoices_unpaid: [], applications_released: 0, tanggal: "2026-11-11" };
beforeEach(() => { state.rpc = []; state.reply = { data: null, error: null }; state.revalidated = []; });

it("mengirim tagihan, kunci dan alasan ke RPC tunggal; sukses me-revalidate dan mengembalikan hasil", async () => {
  state.reply = { data: OK, error: null };
  const r = await batalkanPenerimaanKlinik(form());
  expect(r.ok && r.hasil.invoice_no).toBe("INV-9");
  expect(state.rpc).toEqual([{ name: "clinic_cancel_invoice_receipt", params: { p_invoice_id: U(2), p_request_key: "kunci-1", p_reason: "Harga vaksin salah, disetujui pemilik" } }]);
  expect(state.revalidated.length).toBe(1);
});
it("isian tidak valid ditolak di server tanpa memanggil database", async () => {
  for (const f of [form({ invoice_id: "x" }), form({ visit_id: "" }), form({ reason: "  a " }), form({ reason: "x".repeat(501) }), form({ request_key: "" }), form({ request_key: "k".repeat(101) })]) {
    const r = await batalkanPenerimaanKlinik(f); expect(r.ok).toBe(false);
  }
  expect(state.rpc).toEqual([]);
});
it("penolakan database diterjemahkan ke Indonesia dan tidak ada revalidate", async () => {
  state.reply = { data: null, error: { message: "BATAL_PENERIMAAN_SUDAH_REFUND: Tagihan ini sudah/sedang direfund. Selesaikan dulu." } };
  const r = await batalkanPenerimaanKlinik(form());
  expect(!r.ok && r.pesan).toBe("Tagihan ini sudah/sedang direfund. Selesaikan dulu.");
  expect(state.revalidated).toEqual([]);
  state.reply = { data: null, error: { message: "ACCESS_DENIED: hanya Owner" } };
  const r2 = await batalkanPenerimaanKlinik(form()); expect(!r2.ok && r2.pesan).toMatch(/Hanya Owner/);
});
it("jawaban yang tidak sesuai (status lain / tagihan lain) tidak dianggap sukses", async () => {
  state.reply = { data: { ...OK, status: "OK" }, error: null }; expect((await batalkanPenerimaanKlinik(form())).ok).toBe(false);
  state.reply = { data: { ...OK, invoice_id: U(9) }, error: null }; expect((await batalkanPenerimaanKlinik(form())).ok).toBe(false);
  state.reply = { data: null, error: null }; expect((await batalkanPenerimaanKlinik(form())).ok).toBe(false);
  expect(state.revalidated).toEqual([]);
});
