import { beforeEach, expect, it, vi } from "vitest";

// Aksi server laci kasir: akses halaman tidak sama dengan memegang laci orang lain.
// Basis data adalah batas keamanannya (scripts/test-shift-laci-milik-kasir-postgres.py);
// tes ini memastikan aksi tidak pernah mencoba menutup laci orang lain dan tutup paksa
// hanya lewat fungsi supervisor yang beralasan.
const fx = vi.hoisted(() => ({
  user: "kasir-a" as string | null,
  shift: null as null | { id: string; shift_type: string; opening_balance: number; branch_id: string; opened_by: string; status: string },
  periode: null as string | null,
  tutup: [] as unknown[],
  rpc: [] as { fn: string; args: Record<string, unknown> }[],
  rpcError: null as null | { message: string },
  updates: 0,
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => fx.periode }));
vi.mock("@/lib/tutup-shift", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@/lib/tutup-shift")>();
  return {
    ...asli,
    bacaShift: async () => fx.shift,
    hitungShift: async () => ({ expected: 275000, breakdown: { Tunai: 125000, Transfer: 50000 } }),
    tutupShift: async (_s: unknown, o: unknown) => { fx.tutup.push(o); return { ok: true, expected: 0, selisih: 0, breakdown: {}, dibebankanKe: null }; },
  };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: fx.user ? { id: fx.user } : null } }) },
  from: () => ({ update: () => { fx.updates += 1; throw new Error("aksi tidak boleh menulis tabel laci langsung"); } }),
  rpc: async (fn: string, args: Record<string, unknown>) => { fx.rpc.push({ fn, args }); return { data: null, error: fx.rpcError }; },
}) }));

import { tutupShiftKlinik } from "@/app/(app)/klinik/shift/actions";
import { closeShift, forceCloseShift } from "@/app/(app)/pos/shift/actions";

const laci = (opened_by: string, shift_type = "klinik") =>
  ({ id: "laci-1", shift_type, opening_balance: 150000, branch_id: "cabang-a", opened_by, status: "open" });
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

beforeEach(() => {
  fx.user = "kasir-a"; fx.shift = laci("kasir-a"); fx.periode = null; fx.tutup = []; fx.rpc = []; fx.rpcError = null; fx.updates = 0;
});

it("menutup laci klinik milik sendiri seperti biasa", async () => {
  await expect(tutupShiftKlinik(form({ shiftId: "laci-1", closing_balance: "150000" }))).rejects.toThrow("REDIRECT:/klinik/shift/laci-1?success=closed");
  expect(fx.tutup).toEqual([{ shift: fx.shift, closing: 150000 }]);
});

it.each(["admin-cabang", "owner", "finance", "dokter"])("akun %s tidak bisa menutup laci klinik kasir lain lewat form", async (aktor) => {
  fx.user = aktor;
  await expect(tutupShiftKlinik(form({ shiftId: "laci-1", closing_balance: "0" }))).rejects.toThrow(/REDIRECT:\/klinik\/shift\?error=.*milik%20kasir%20lain/);
  expect(fx.tutup).toHaveLength(0);
});

it("periode terkunci tetap mencegah tutup laci sendiri", async () => {
  fx.periode = "Periode sudah ditutup";
  await expect(tutupShiftKlinik(form({ shiftId: "laci-1", closing_balance: "1" }))).rejects.toThrow("REDIRECT:/klinik/shift?error=Periode");
  expect(fx.tutup).toHaveLength(0);
});

it("layar backoffice tidak bisa menutup laci kasir lain (klinik maupun petshop)", async () => {
  for (const jenis of ["klinik", "petshop"]) {
    fx.shift = laci("kasir-b", jenis);
    await expect(closeShift(form({ shiftId: "laci-1", closing_balance: "0" }))).rejects.toThrow(/REDIRECT:\/pos\/shift\?error=.*milik%20kasir%20lain/);
  }
  expect(fx.tutup).toHaveLength(0);
  fx.shift = laci("kasir-a", "petshop");
  await expect(closeShift(form({ shiftId: "laci-1", closing_balance: "5" }))).rejects.toThrow("REDIRECT:/pos/shift?success=close");
  expect(fx.tutup).toHaveLength(1);
});

it("tutup paksa tanpa alasan ditolak sebelum menyentuh basis data", async () => {
  fx.user = "admin-cabang"; fx.shift = laci("kasir-b");
  await expect(forceCloseShift(form({ shiftId: "laci-1", alasan: "  lupa " }))).rejects.toThrow(/REDIRECT:\/pos\/shift\?error=.*alasan/);
  expect(fx.rpc).toHaveLength(0);
  expect(fx.tutup).toHaveLength(0);
});

it("tutup paksa hanya lewat fungsi supervisor beralasan, tidak menulis laci langsung", async () => {
  fx.user = "admin-cabang"; fx.shift = laci("kasir-b");
  await expect(forceCloseShift(form({ shiftId: "laci-1", alasan: "Kasir lupa menutup laci kemarin" }))).rejects.toThrow("REDIRECT:/pos/shift?success=force");
  expect(fx.rpc).toEqual([{ fn: "cashier_shift_supervisor_close", args: {
    p_shift_id: "laci-1", p_reason: "Kasir lupa menutup laci kemarin", p_expected: 275000, p_breakdown: { Tunai: 125000, Transfer: 50000 } } }]);
  expect(fx.tutup).toHaveLength(0);
  expect(fx.updates).toBe(0);
});

it("penolakan supervisor dari basis data tampil tanpa kode teknis", async () => {
  fx.user = "finance"; fx.shift = laci("kasir-b");
  fx.rpcError = { message: "SHIFT_SUPERVISOR_DENIED: hanya Owner/Admin cabang yang bisa tutup paksa laci" };
  await expect(forceCloseShift(form({ shiftId: "laci-1", alasan: "Kasir lupa menutup laci kemarin" })))
    .rejects.toThrow(`REDIRECT:/pos/shift?error=${encodeURIComponent("hanya Owner/Admin cabang yang bisa tutup paksa laci")}`);
});
