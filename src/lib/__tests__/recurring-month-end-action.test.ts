import { describe, expect, it, vi } from "vitest";
import { jalankanAkhirBulanSekarang } from "../../app/(app)/keuangan/tutup-buku/actions";

const { run, redirect, revalidatePath } = vi.hoisted(() => ({
  run: vi.fn(async () => { throw new Error("RECURRING_HISTORY: jurnal lama tidak lengkap"); }),
  redirect: vi.fn((location: string) => { throw new Error(`REDIRECT:${location}`); }),
  revalidatePath: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "fiction-owner" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "OWNER" }, error: null }) }) }) }),
}) }));
vi.mock("@/lib/akhir-bulan-server", () => ({ jalankanAkhirBulan: run }));
vi.mock("@/lib/akhir-bulan", async () => await import("../akhir-bulan"));
vi.mock("@/lib/ledger", () => ({ getAccountBalances: vi.fn() }));
vi.mock("@/lib/tutup-buku", () => ({ buildClosingLines: vi.fn() }));
vi.mock("@/lib/posting", () => ({ nextSeqJurnal: vi.fn(), prefixJurnal: vi.fn() }));
vi.mock("@/lib/no-dokumen", () => ({ formatNomor: vi.fn() }));

describe("manual month-end recurring failure", () => {
  it("returns the financial error to the form without claiming success", async () => {
    const form = new FormData(); form.set("kunci_sekalian", "on");
    await expect(jalankanAkhirBulanSekarang(form)).rejects.toThrow("REDIRECT:/keuangan/tutup-buku?error=");
    expect(redirect).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent("jurnal lama tidak lengkap")));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
