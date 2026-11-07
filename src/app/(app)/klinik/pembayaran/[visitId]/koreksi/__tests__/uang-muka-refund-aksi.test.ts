// Aksi server "Kembalikan saldo uang muka": hanya memanggil RPC pengajuan dengan isian tervalidasi; galat diterjemahkan ke Indonesia.
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: [] as { name: string; params: Record<string, unknown> }[],
  reply: { data: null as unknown, error: null as { message: string } | null },
  revalidated: [] as string[],
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: async (name: string, params: Record<string, unknown>) => { state.rpc.push({ name, params }); return state.reply; } }) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { state.revalidated.push(p); } }));
import { ajukanRefundUangMuka } from "../uang-muka-refund-actions";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function form(over: Record<string, string> = {}) {
  const f = new FormData();
  const base: Record<string, string> = { advance_id: U(1), amount: "30000", reason: "Dikembalikan sesuai keputusan Andri", bank: "BCA", account: "1234567890", holder: "Keripik Tempe", request_key: "kunci-1", ...over };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
}
const OK = { refund_id: U(9), no_refund: "RUM-202611-0001", status: "pending", amount: 30000, no_uang_muka: "UMK-202611-0045", balance_before: 30000, balance_after: 0 };
beforeEach(() => { state.rpc = []; state.reply = { data: OK, error: null }; state.revalidated = []; });

it("mengirim jumlah, alasan, tujuan transfer dan kunci permintaan ke RPC pengajuan; sukses me-revalidate dan mengembalikan nomor refund", async () => {
  const r = await ajukanRefundUangMuka(form());
  expect(r.ok && r.noRefund).toBe("RUM-202611-0001");
  expect(state.rpc).toEqual([{ name: "clinic_advance_refund_request", params: { p_advance_id: U(1), p_amount: 30000, p_reason: "Dikembalikan sesuai keputusan Andri", p_destination: { bank: "BCA", account: "1234567890", name: "Keripik Tempe" }, p_request_key: "kunci-1" } }]);
  expect(state.revalidated.length).toBe(1);
});

it("jumlah dengan koma Indonesia atau titik ribuan dibaca benar; jumlah desimal 2 digit diterima", async () => {
  await ajukanRefundUangMuka(form({ amount: "30.000" }));
  await ajukanRefundUangMuka(form({ amount: "1000,5" }));
  expect(state.rpc.map((c) => c.params.p_amount)).toEqual([30000, 1000.5]);
});

it("isian tidak valid ditolak sebelum menyentuh database: jumlah nol/negatif/huruf/3 desimal, alasan pendek, tujuan kosong, kunci kosong, id bukan uuid", async () => {
  const buruk: Record<string, string>[] = [{ amount: "0" }, { amount: "-5" }, { amount: "abc" }, { amount: "10,001" }, { amount: "" }, { reason: "ab c" }, { reason: "x".repeat(501) },
    { bank: "" }, { account: "12;drop" }, { holder: "" }, { request_key: "" }, { advance_id: "x" }];
  for (const bad of buruk) {
    const r = await ajukanRefundUangMuka(form(bad));
    expect(r.ok, JSON.stringify(bad)).toBe(false);
  }
  expect(state.rpc).toEqual([]);
});

it("penolakan database diterjemahkan ke Indonesia dan tidak ada revalidate", async () => {
  state.reply = { data: null, error: { message: "AMOUNT_EXCEEDS: jumlah 40000.00 melebihi saldo uang muka yang belum terpakai (30000.00)" } };
  const r = await ajukanRefundUangMuka(form());
  expect(r.ok).toBe(false);
  expect(!r.ok && r.pesan).toContain("melebihi saldo");
  expect(state.revalidated).toEqual([]);
});

it("respons kosong, status bukan pending, atau nomor refund hilang tidak dianggap sukses", async () => {
  for (const data of [null, { status: "LAIN" }, { status: "pending" }, { ...OK, status: "selesai" }]) {
    state.reply = { data, error: null };
    expect((await ajukanRefundUangMuka(form())).ok, JSON.stringify(data)).toBe(false);
  }
  expect(state.revalidated).toEqual([]);
});
