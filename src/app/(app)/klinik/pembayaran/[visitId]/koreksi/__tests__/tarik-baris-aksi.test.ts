// Aksi server "Tarik baris (Owner)": hanya memanggil RPC pratinjau/eksekusi dengan isian tervalidasi; galat diterjemahkan ke Indonesia.
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: [] as { name: string; params: Record<string, unknown> }[],
  reply: { data: null as unknown, error: null as { message: string } | null },
  revalidated: [] as string[],
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: async (name: string, params: Record<string, unknown>) => { state.rpc.push({ name, params }); return state.reply; } }) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { state.revalidated.push(p); } }));
import { pratinjauTarikBaris, tarikBarisLunas } from "../actions";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function form(over: Record<string, string | string[]> = {}) {
  const f = new FormData();
  const base: Record<string, string | string[]> = { visit_id: U(1), invoice_id: U(2), reason: "Infus tidak jadi dipakai", request_key: "kunci-1", line: [U(3)], ...over };
  for (const [k, v] of Object.entries(base)) (Array.isArray(v) ? v : [v]).forEach((x) => f.append(k, x));
  return f;
}
beforeEach(() => { state.rpc = []; state.reply = { data: null, error: null }; state.revalidated = []; });

it("pratinjau memanggil hanya RPC quote baca-saja dan mengembalikan angkanya", async () => {
  state.reply = { data: { invoice_no: "INV-1", total_before: 100, total_after: 70, removed_total: 30, hpp_removed: 10, stock: [], journals: [], advance: { no_uang_muka: "UMK-1", balance_before: 0, balance_after: 30 } }, error: null };
  const r = await pratinjauTarikBaris(form());
  expect(r.ok && r.selesai).toBe(false);
  expect(state.rpc.map((c) => c.name)).toEqual(["clinic_owner_invoice_lines_quote"]);
  expect(state.rpc[0].params).toEqual({ p_invoice_id: U(2), p_lines: [{ invoice_item_id: U(3) }] });
  expect(state.revalidated).toEqual([]);
});

it("eksekusi mengirim alasan, kunci permintaan dan baris; sukses me-revalidate dan menandai selesai", async () => {
  state.reply = { data: { status: "OK", invoice_no: "INV-1", total_before: 100, total_after: 70, removed_total: 30, hpp_removed: 10, stock: [], journals: [], advance: { no_uang_muka: "UMK-1", balance_before: 0, balance_after: 30 } }, error: null };
  const r = await tarikBarisLunas(form());
  expect(r.ok && r.selesai).toBe(true);
  expect(state.rpc[0]).toEqual({ name: "clinic_owner_remove_invoice_lines", params: { p_invoice_id: U(2), p_lines: [{ invoice_item_id: U(3) }], p_reason: "Infus tidak jadi dipakai", p_request_key: "kunci-1" } });
  expect(state.revalidated.length).toBe(1);
});

it("penolakan database diterjemahkan ke Indonesia dan tidak ada revalidate", async () => {
  state.reply = { data: null, error: { message: "COST_MISMATCH: HPP baris X (1) tidak sama dengan biaya BMHP-nya (2)" } };
  const r = await tarikBarisLunas(form());
  expect(r.ok).toBe(false);
  expect(!r.ok && r.pesan).toContain("HPP baris tidak sama");
  expect(state.revalidated).toEqual([]);
});

it("isian tidak valid ditolak sebelum menyentuh database: alasan pendek, tanpa baris, id bukan uuid, baris dobel, kunci kosong", async () => {
  for (const bad of [{ reason: "ab c" }, { line: [] as string[] }, { line: ["bukan-uuid"] }, { line: [U(3), U(3)] }, { request_key: "" }, { invoice_id: "x" }] as Record<string, string | string[]>[]) {
    const r = await tarikBarisLunas(form(bad));
    expect(r.ok, JSON.stringify(bad)).toBe(false);
  }
  expect(state.rpc).toEqual([]);
});

it("respons kosong atau status bukan OK tidak dianggap sukses", async () => {
  state.reply = { data: { status: "LAIN" }, error: null };
  expect((await tarikBarisLunas(form())).ok).toBe(false);
  state.reply = { data: null, error: null };
  expect((await tarikBarisLunas(form())).ok).toBe(false);
  expect(state.revalidated).toEqual([]);
});
