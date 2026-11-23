import { beforeEach, describe, expect, it, vi } from "vitest";

// Tanggal mundur: semua akun yang boleh input pengeluaran (keputusan Owner / Andri 23 Nov 2026), di keempat aksi simpan.
const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: fixture.rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(Error(url), { digest: "NEXT_REDIRECT" }); } }));

import { saveExpense } from "@/lib/expense-save";
import { hariIniWIB } from "@/lib/tanggal";
import { geserTanggalISO } from "@/lib/tanggal-mundur";
import { simpanPengeluaranKasir } from "@/app/kasir/pengeluaran/actions";
import { simpanPengeluaranKlinik } from "@/app/(app)/klinik/pengeluaran/actions";
import { simpanExpense } from "@/app/(app)/pos/expense/actions";
import { catatBeban } from "@/app/(app)/buku-besar/beban/actions";

const today = hariIniWIB();
const hariLalu = (n: number) => geserTanggalISO(today, -n);
function form(extra: Record<string, string> = {}) {
  const data = new FormData();
  const base: Record<string, string> = {
    request_key: "k1", draft_key: "k1", draft_scope: "cashier-expense:shift", jumlah: "80000", kategori: "Transportasi", branchId: "b1", branch_id: "b1",
    deskripsi: "Transport", metode_bayar: "Tunai", metode: "Tunai", tanggal: today,
    lampiran: JSON.stringify([{ path: "pengeluaran/1-a.png", nama: "a.png", mime: "image/png", ukuran: 100 }]), ...extra,
  };
  for (const [k, v] of Object.entries(base)) data.set(k, v);
  return data;
}
const expenseArg = () => fixture.rpc.mock.calls.at(-1)![1].p_expense as Record<string, unknown>;
beforeEach(() => {
  fixture.rpc.mockReset();
  fixture.rpc.mockResolvedValue({ data: { expense_id: "e", journal_id: "j" }, error: null });
});

describe("tanggal mundur: aturan di sisi server aplikasi", () => {
  it.each(["cashier", "clinic", "backoffice"] as const)("konteks %s: tanggal mundur beralasan dikirim ke database tanpa izin khusus", async (konteks) => {
    const out = await saveExpense(form({ tanggal: hariLalu(2), alasan_tanggal: "  Nota listrik terlupa  " }), konteks);
    expect(out).toEqual({ expense_id: "e", journal_id: "j" });
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
    expect(expenseArg()).toMatchObject({ tanggal: hariLalu(2), alasan_tanggal: "Nota listrik terlupa", jumlah: 80000 });
    expect(fixture.rpc.mock.calls[0][1].p_context).toBe(konteks);
  });

  it("hari ini: bentuk lama, tanpa alasan_tanggal walau kolom alasan terisi", async () => {
    await saveExpense(form({ alasan_tanggal: "diabaikan" }), "cashier");
    expect(expenseArg().tanggal).toBe(today);
    expect("alasan_tanggal" in expenseArg()).toBe(false);
  });

  it("tanggal kosong = hari ini (bentuk lama)", async () => {
    await saveExpense(form({ tanggal: "" }), "backoffice");
    expect(expenseArg().tanggal).toBe(today);
  });

  it.each([undefined, "", "  ", "ab", " a "])("mundur tanpa alasan sah (%j) dikembalikan sebagai penolakan, database tidak dipanggil", async (alasan) => {
    const out = await saveExpense(form({ tanggal: hariLalu(1), ...(alasan === undefined ? {} : { alasan_tanggal: alasan }) }), "cashier");
    expect(out).toMatchObject({ ok: false, outcome: "rejected", code: "backdate_invalid" });
    expect((out as { message: string }).message).toMatch(/alasan 3-200 huruf/);
    expect((out as { message: string }).message).toMatch(/BELUM tersimpan/);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it("alasan 201 huruf ditolak, 200 huruf diterima, 3 huruf diterima", async () => {
    expect(await saveExpense(form({ tanggal: hariLalu(1), alasan_tanggal: "x".repeat(201) }), "cashier")).toMatchObject({ code: "backdate_invalid" });
    expect(fixture.rpc).not.toHaveBeenCalled();
    await saveExpense(form({ tanggal: hariLalu(1), alasan_tanggal: "y".repeat(200) }), "cashier");
    await saveExpense(form({ tanggal: hariLalu(1), alasan_tanggal: "abc" }), "cashier");
    expect(fixture.rpc).toHaveBeenCalledTimes(2);
  });

  it("31 hari ke belakang diterima, 32 hari ditolak sebelum menyentuh database", async () => {
    await saveExpense(form({ tanggal: hariLalu(31), alasan_tanggal: "tagihan lama" }), "backoffice");
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
    const out = await saveExpense(form({ tanggal: hariLalu(32), alasan_tanggal: "tagihan lama" }), "backoffice");
    expect(out).toMatchObject({ ok: false, code: "backdate_invalid" });
    expect((out as { message: string }).message).toMatch(/31 hari/);
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([geserTanggalISO(today, 1), geserTanggalISO(today, 30)])("tanggal masa depan %s ditolak", async (tanggal) => {
    const out = await saveExpense(form({ tanggal, alasan_tanggal: "coba masa depan" }), "cashier");
    expect(out).toMatchObject({ ok: false, code: "backdate_invalid" });
    expect((out as { message: string }).message).toMatch(/masa depan/);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it.each(["2026-02-31", "kemarin", "2026/11/01", "11-11-2026"])("tanggal tidak sah %s ditolak", async (tanggal) => {
    expect(await saveExpense(form({ tanggal, alasan_tanggal: "alasan sah" }), "cashier")).toMatchObject({ ok: false, code: "backdate_invalid" });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
});

describe("tanggal mundur: penolakan database dikembalikan, bukan dilempar", () => {
  it.each([
    "Tanggal mundur: rekonsiliasi bank sudah mencakup rekening pembayaran ini pada/sesudah tanggal itu; koreksi rekonsiliasi dahulu atau pilih rekening/tanggal lain.",
    "Tanggal mundur: alasan wajib diisi (3-200 huruf) untuk pengeluaran bertanggal sebelum hari ini.",
    "Tanggal mundur: paling lama 31 hari ke belakang. Lebih lama dari itu perlu koreksi pembukuan, bukan input pengeluaran.",
  ])("pesan database %#", async (message) => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message } });
    const out = await saveExpense(form({ tanggal: hariLalu(2), alasan_tanggal: "alasan sah" }), "cashier");
    expect(out).toMatchObject({ ok: false, outcome: "rejected", code: "backdate_rejected" });
    expect((out as { message: string }).message).toContain(message);
    expect((out as { message: string }).message).toMatch(/BELUM tersimpan/);
  });

  it("periode akuntansi ditutup pada tanggal mundur: penolakan yang terbaca (pesan jelas)", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "Periode akuntansi sudah ditutup" } });
    const out = await saveExpense(form({ tanggal: hariLalu(3), alasan_tanggal: "alasan sah" }), "clinic");
    expect(out).toMatchObject({ ok: false, code: "backdate_rejected" });
    expect((out as { message: string }).message).toMatch(/Periode akuntansi untuk tanggal itu sudah ditutup/);
  });

  it("periode ditutup pada tanggal HARI INI tetap galat lama (dilempar), tidak ikut jalur tanggal mundur", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "Periode akuntansi sudah ditutup" } });
    await expect(saveExpense(form(), "clinic")).rejects.toThrow("Periode akuntansi sudah ditutup");
  });

  it("galat lain pada tanggal mundur tetap dilempar (tidak disamarkan sebagai tanggal mundur)", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "Akses pengeluaran ditolak." } });
    await expect(saveExpense(form({ tanggal: hariLalu(2), alasan_tanggal: "alasan sah" }), "cashier")).rejects.toThrow("Akses pengeluaran ditolak.");
  });

  it("kunci basi tetap diperlakukan seperti sebelumnya", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "Permintaan sudah digunakan dengan rincian berbeda" } });
    expect(await saveExpense(form({ tanggal: hariLalu(2), alasan_tanggal: "alasan sah" }), "cashier")).toMatchObject({ code: "stale_request_key" });
  });
});

describe("keempat aksi simpan memakai jalur yang sama", () => {
  it.each([
    ["kasir petshop", simpanPengeluaranKasir, "cashier"],
    ["klinik", simpanPengeluaranKlinik, "clinic"],
    ["back office /pos/expense", simpanExpense, "backoffice"],
    ["back office /buku-besar/beban", catatBeban, "backoffice"],
  ] as const)("%s: tanggal mundur beralasan -> database, redirect sukses", async (_nama, action, konteks) => {
    await expect(action(form({ tanggal: hariLalu(4), alasan_tanggal: "uji empat layar" }))).rejects.toThrow(/success=1/);
    expect(fixture.rpc.mock.calls[0][1].p_context).toBe(konteks);
    expect(expenseArg()).toMatchObject({ tanggal: hariLalu(4), alasan_tanggal: "uji empat layar" });
  });

  it.each([
    ["kasir petshop", simpanPengeluaranKasir],
    ["klinik", simpanPengeluaranKlinik],
    ["back office /pos/expense", simpanExpense],
    ["back office /buku-besar/beban", catatBeban],
  ] as const)("%s: mundur tanpa alasan -> penolakan dikembalikan, tanpa redirect dan tanpa database", async (_nama, action) => {
    await expect(action(form({ tanggal: hariLalu(4) }))).resolves.toMatchObject({ ok: false, code: "backdate_invalid" });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it("back office: tanggal lampau sembarang tanpa alasan (perilaku lama yang terbuka) kini ditolak", async () => {
    await expect(simpanExpense(form({ tanggal: "2025-01-01" }))).resolves.toMatchObject({ ok: false, code: "backdate_invalid" });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
});
