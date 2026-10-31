// Aksi pelunasan DP lama: memanggil pembungkus writer kwitansi asli dengan sisa yang
// dilihat kasir, gagal tertutup sebelum uang bila shift/periode/isian tidak sah.
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  shift: { id: "laci-kasir" } as { id: string } | null,
  periode: null as string | null,
  rpcError: null as { code?: string; message: string } | null,
  rpc: [] as { name: string; params: Record<string, unknown> }[],
  revalidated: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "kasir" } } }) },
  rpc: async (name: string, params: Record<string, unknown>) => {
    state.rpc.push({ name, params });
    return state.rpcError ? { data: null, error: state.rpcError } : { data: "kwitansi-1", error: null };
  },
}) }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => state.shift }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => state.periode }));
vi.mock("@/lib/tanggal", () => ({ hariIniWIB: () => "2026-10-31" }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => { state.revalidated.push(path); } }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("REDIRECT " + url); } }));

import { lunasiTagihanKlinik } from "../pelunasan-actions";

beforeEach(() => {
  state.shift = { id: "laci-kasir" }; state.periode = null; state.rpcError = null; state.rpc = []; state.revalidated = [];
});

function form(fields: Record<string, string> = {}) {
  const data = new FormData();
  const base: Record<string, string> = {
    visitId: "visit-1", invoice_id: "inv-1", request_key: "kunci-1", expected_remaining: "20000",
    parts: JSON.stringify([{ method: "Tunai", amount: 5000 }, { method: "Transfer", amount: 15000 }]),
  };
  for (const [key, value] of Object.entries({ ...base, ...fields })) data.set(key, value);
  return data;
}

async function jalankan(data: FormData) {
  try { await lunasiTagihanKlinik(data); return "NO_REDIRECT"; } catch (error) { return (error as Error).message; }
}

it("melunasi invoice yang sama lewat pembungkus writer kwitansi asli", async () => {
  const hasil = await jalankan(form());
  expect(state.rpc).toEqual([{ name: "clinic_settle_outpatient_invoice", params: {
    p_visit_id: "visit-1", p_invoice_id: "inv-1", p_request_key: "kunci-1",
    p_parts: [{ method: "Tunai", amount: 5000 }, { method: "Transfer", amount: 15000 }], p_expected_remaining: 20000,
  } }]);
  expect(hasil).toBe("REDIRECT /klinik/pembayaran/visit-1?success=bayar");
  expect(state.revalidated).toContain("/klinik/pembayaran/visit-1");
});

it("mengarahkan ke shift tanpa memanggil writer uang bila laci kasir belum dibuka", async () => {
  state.shift = null;
  expect(await jalankan(form())).toMatch(/^REDIRECT \/klinik\/shift\?error=/);
  expect(state.rpc).toEqual([]);
});

it("menolak periode tertutup sebelum uang ditulis", async () => {
  state.periode = "Periode Oktober sudah ditutup";
  expect(await jalankan(form())).toBe("REDIRECT /klinik/pembayaran/visit-1?error=" + encodeURIComponent("Periode Oktober sudah ditutup"));
  expect(state.rpc).toEqual([]);
});

it.each([
  ["tanpa kunci permintaan", { request_key: "" }],
  ["tanpa invoice", { invoice_id: "" }],
  ["sisa tidak terbaca", { expected_remaining: "" }],
  ["rincian rusak", { parts: "x" }],
  ["nominal nol", { parts: JSON.stringify([{ method: "Tunai", amount: 0 }]) }],
  ["melebihi sisa yang dilihat kasir", { parts: JSON.stringify([{ method: "Tunai", amount: 25000 }]) }],
])("gagal tertutup tanpa RPC: %s", async (_label, fields) => {
  expect(await jalankan(form(fields))).toMatch(/^REDIRECT \/klinik\/pembayaran\/visit-1\?error=/);
  expect(state.rpc).toEqual([]);
});

it("menampilkan sisa terbaru bila kasir lain lebih dulu menerima uang", async () => {
  state.rpcError = { code: "P0001", message: "REMAINING_CHANGED: sisa tagihan sekarang Rp 15000" };
  const hasil = decodeURIComponent(await jalankan(form()));
  expect(hasil).toContain("Sisa tagihan sudah berubah (sisa tagihan sekarang Rp 15000)");
  expect(hasil).not.toContain("success=");
  expect(state.revalidated).toEqual([]);
});

it("tidak mengklaim sukses saat hasil writer tidak pasti", async () => {
  state.rpcError = { message: "fetch failed" };
  const hasil = decodeURIComponent(await jalankan(form()));
  expect(hasil).toMatch(/belum dapat dipastikan/);
  expect(hasil).not.toContain("success=");
});
