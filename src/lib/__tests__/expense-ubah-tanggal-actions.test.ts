import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), tanggalLama: "2026-11-20" as string | null, bacaError: null as null | { message: string } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: fixture.rpc,
    from: (tabel: string) => { expect(tabel).toBe("expenses"); return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: fixture.tanggalLama ? { tanggal: fixture.tanggalLama } : null, error: fixture.bacaError }) }) }) }; },
  }),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { ubahExpense, batalkanExpense } from "@/app/(app)/pos/expense/actions";

const id = "ee400000-0000-4000-8000-000000000002";
function form(over: Record<string, string> = {}) {
  const data = new FormData();
  Object.entries({ id, revision: "0", request_key: "k-ubah", draft_key: "k-ubah", draft_scope: `expense-edit:${id}:0`, kembali: "/buku-besar/beban",
    tanggal: "2026-11-20", kategori: "Operasional", deskripsi: "x", jumlah: "30000", metode_bayar: "Tunai", alasan: "Salah nominal", ...over }).forEach(([k, v]) => data.set(k, v));
  return data;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-26T03:00:00Z")); // 26 Nov 10:00 WIB
  fixture.tanggalLama = "2026-11-20"; fixture.bacaError = null;
  fixture.rpc.mockResolvedValue({ data: { expense_id: id, journal_id: "j" }, error: null });
});
afterEach(() => vi.useRealTimers());

describe("Ubah pengeluaran: aturan tanggal sama dengan input baru", () => {
  it("masa depan: dikembalikan sebagai penolakan, database tidak dipanggil", async () => {
    const out = await ubahExpense(form({ tanggal: "2026-11-27" }));
    expect(out).toMatchObject({ ok: false, outcome: "rejected", code: "backdate_invalid" });
    expect((out as { message: string }).message).toMatch(/masa depan.*BELUM tersimpan/);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("200 hari lalu (contoh review MINOR-2) ditolak walau alasan 3 huruf", async () => {
    fixture.tanggalLama = "2026-11-26";
    const out = await ubahExpense(form({ tanggal: "2026-05-10", alasan: "abc" }));
    expect(out).toMatchObject({ ok: false, code: "backdate_invalid" });
    expect((out as { message: string }).message).toMatch(/31 hari/);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("tanggal lama yang tidak diganti boleh sangat lama (hanya nominal dikoreksi)", async () => {
    fixture.tanggalLama = "2026-05-07";
    await expect(ubahExpense(form({ tanggal: "2026-05-07" }))).rejects.toThrow("success=edit");
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });
  it("diganti ke 31 hari lalu dengan alasan: diteruskan ke RPC beserta alasan koreksi", async () => {
    await expect(ubahExpense(form({ tanggal: "2026-10-26", alasan: "Nota salah tanggal" }))).rejects.toThrow("success=edit");
    const [nama, payload] = fixture.rpc.mock.calls[0];
    expect(nama).toBe("revise_expense_atomic");
    expect(payload).toMatchObject({ p_reason: "Nota salah tanggal", p_expense: { tanggal: "2026-10-26" } });
  });
  it("diganti ke 32 hari lalu: ditolak", async () => {
    expect(await ubahExpense(form({ tanggal: "2026-10-25" }))).toMatchObject({ ok: false });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("diganti ke masa lalu dengan alasan tanpa huruf/angka: ditolak (dilempar sebagai alasan koreksi tidak sah)", async () => {
    await expect(ubahExpense(form({ tanggal: "2026-11-10", alasan: "..." }))).rejects.toThrow(/Alasan koreksi/);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("alasan koreksi >200 saat tanggal diganti ke masa lalu: ditolak; <=1000 saat tanggal tetap: lolos", async () => {
    expect(await ubahExpense(form({ tanggal: "2026-11-10", alasan: "x".repeat(201) }))).toMatchObject({ ok: false, code: "backdate_invalid" });
    await expect(ubahExpense(form({ alasan: "x".repeat(900) }))).rejects.toThrow("success=edit");
  });
  it("tanggal tersimpan tidak terbaca: ditolak aman, tidak menebak", async () => {
    fixture.tanggalLama = null;
    expect(await ubahExpense(form())).toMatchObject({ ok: false, message: expect.stringContaining("BELUM tersimpan") });
    fixture.tanggalLama = "2026-11-20"; fixture.bacaError = { message: "denied" };
    expect(await ubahExpense(form())).toMatchObject({ ok: false });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("periode ditutup / revisi basi dari database: dikembalikan (terbaca di produksi), bukan dilempar", async () => {
    for (const pesan of ["Periode akuntansi sudah ditutup", "Pengeluaran sudah berubah. Muat ulang detail sebelum mengoreksi."]) {
      fixture.rpc.mockResolvedValueOnce({ data: null, error: { message: pesan } });
      const out = await ubahExpense(form());
      expect(out).toMatchObject({ ok: false, outcome: "rejected", code: "backdate_rejected" });
      expect((out as { message: string }).message).toContain("BELUM tersimpan");
    }
  });
  it("galat tak dikenal tetap dilempar (hasil belum pasti, kunci permintaan dijaga form)", async () => {
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { message: "fetch failed" } });
    await expect(ubahExpense(form())).rejects.toThrow("fetch failed");
  });
  it("Batalkan tidak memeriksa tanggal dan tidak membaca pengeluaran; alasan tanpa huruf/angka ditolak", async () => {
    fixture.tanggalLama = null;
    await expect(batalkanExpense(form({ tanggal: "2000-01-01" }))).rejects.toThrow("success=void");
    await expect(batalkanExpense(form({ alasan: "---" }))).rejects.toThrow(/Alasan koreksi/);
  });
});
