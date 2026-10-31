import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ writes: 0 }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: () => { state.writes++; throw Error("database write/read reached"); },
}) }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/kas-akun", () => ({ kodeAkunBayar: async () => { throw Error("Kas Tunai cabang belum terhubung"); } }));
import { simpanPengeluaranKlinik } from "@/app/(app)/klinik/pengeluaran/actions";

it("rejects an unmapped clinic cash expense before inserting it", async () => {
  state.writes = 0;
  const form = new FormData();
  form.set("branchId", "LOJI"); form.set("tanggal", "2026-10-31");
  form.set("kategori", "Listrik & Air"); form.set("jumlah", "1000"); form.set("metode_bayar", "Tunai");
  await expect(simpanPengeluaranKlinik(form)).rejects.toThrow("Kas%20Tunai%20cabang%20belum%20terhubung");
  expect(state.writes).toBe(0);
});
