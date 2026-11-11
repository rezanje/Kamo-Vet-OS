import { beforeEach, describe, expect, it, vi } from "vitest";

// Laporan 11 Nov 2026 (klinik Panduraya): kunci permintaan simpan yang sudah terpakai pengeluaran lain
// ditolak basis data dengan "Permintaan sudah digunakan dengan rincian berbeda". Galat yang DILEMPAR dari
// server action disamarkan Next.js di produksi ("An error occurred in the Server Components render"),
// jadi kasir tidak tahu apa-apa dan tiap percobaan gagal lagi. Penolakan pasti harus DIKEMBALIKAN.
const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: fixture.rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));

import { saveExpense } from "@/lib/expense-save";
import { simpanPengeluaranKlinik } from "@/app/(app)/klinik/pengeluaran/actions";
import { simpanPengeluaranKasir } from "@/app/kasir/pengeluaran/actions";
import { simpanExpense } from "@/app/(app)/pos/expense/actions";

function form(extra: Record<string, string> = {}) {
  const data = new FormData();
  const base: Record<string, string> = {
    request_key: "key-lama", draft_key: "key-lama", draft_scope: "clinic-expense:shift", jumlah: "80000", kategori: "Transportasi",
    deskripsi: "Transport housecall", metode_bayar: "Tunai", tanggal: "2026-11-11",
    lampiran: JSON.stringify([{ path: "pengeluaran/1-a.png", nama: "a.png", mime: "image/png", ukuran: 84374 }]), ...extra,
  };
  for (const [k, v] of Object.entries(base)) data.set(k, v);
  return data;
}

beforeEach(() => fixture.rpc.mockReset());

describe("kunci permintaan simpan pengeluaran yang basi", () => {
  it("dikembalikan sebagai penolakan pasti, bukan dilempar", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "Permintaan sudah digunakan dengan rincian berbeda" } });
    const result = await saveExpense(form(), "clinic");
    expect(result).toMatchObject({ ok: false, outcome: "rejected", code: "stale_request_key" });
    expect((result as { message: string }).message).toMatch(/BELUM tersimpan/);
  });

  it("galat basis data lain tetap dilempar (tidak ikut disamarkan sebagai kunci basi)", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "Periode akuntansi sudah ditutup" } });
    await expect(saveExpense(form(), "clinic")).rejects.toThrow("Periode akuntansi sudah ditutup");
  });

  it("aksi klinik, kasir, dan backoffice mengembalikan penolakan dan TIDAK redirect/revalidasi", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "Permintaan sudah digunakan dengan rincian berbeda" } });
    for (const action of [simpanPengeluaranKlinik, simpanPengeluaranKasir, simpanExpense]) {
      await expect(action(form())).resolves.toMatchObject({ ok: false, code: "stale_request_key" });
    }
  });

  it("simpan sukses tetap redirect seperti biasa", async () => {
    fixture.rpc.mockResolvedValue({ data: { expense_id: "e", journal_id: "j" }, error: null });
    await expect(simpanPengeluaranKlinik(form())).rejects.toThrow(/REDIRECT:\/klinik\/pengeluaran\?success=1/);
  });
});
