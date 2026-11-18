import { beforeEach, describe, expect, it, vi } from "vitest";

// Kasus Andri 18 Nov 2026 (POS-20261117-0009-BJF5): "Batalkan penjualan" / "Batalkan & siapkan pengganti" ditolak database
// (penjaga hadiah staf, SQLSTATE P0001) tetapi aksi server MELEMPAR galat, yang di produksi disamarkan Next.js menjadi
// "Respons simpan belum terkonfirmasi ... Server Components render". Penolakan pasti harus dikembalikan sebagai pesan.
const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc, from: state.from }) }));
import { batalkanPencairan, batalkanPenerimaan, batalkanPenjualan, terimaPembayaranUlang } from "@/app/(app)/penjualan/[id]/actions";

const id = "ba1389a0-f07d-4a69-80ec-54dfb095cdbd";
const STAF = "Transaksi staf berikutnya masih aktif. Batalkan dari transaksi terakhir atau rekonsiliasi hadiah staf terlebih dahulu";
function form(extra: Record<string, string> = {}) {
  const f = new FormData();
  Object.entries({ id, revision: "0", requestKey: "kunci-1", alasan: "kurang item", konfirmasi: "ya", amount_Debit: "17500", ...extra }).forEach(([k, v]) => f.set(k, v));
  return f;
}
beforeEach(() => { vi.clearAllMocks(); state.from.mockImplementation(() => { throw new Error("Tidak boleh membaca sumber langsung"); }); });

describe("Batalkan penjualan: penolakan pasti database dikembalikan sebagai pesan (tidak dilempar)", () => {
  it("penjaga hadiah staf (P0001): pesan jelas + langkah, tanpa pengalihan sukses dan tanpa revalidate", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: STAF } });
    const hasil = await batalkanPenjualan(form({ tindakan: "batal" }));
    expect(hasil).toMatchObject({ ok: false, outcome: "rejected" });
    const pesan = (hasil as { message: string }).message;
    expect(pesan).toMatch(/kasir yang sama sudah membuat transaksi sesudahnya/);
    expect(pesan).toMatch(/Tidak ada yang berubah/);
    expect(pesan).toMatch(/Terima pembayaran/);
    expect(pesan).toMatch(/transaksi baru di Kasir/);
    expect(state.revalidate).not.toHaveBeenCalled();
  });
  it("tombol 'Batalkan & siapkan pengganti' mendapat penolakan yang sama dan tidak membaca struk / mengalihkan", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: STAF } });
    const hasil = await batalkanPenjualan(form({ tindakan: "ganti" }));
    expect(hasil).toMatchObject({ ok: false, outcome: "rejected" });
    expect(state.from).not.toHaveBeenCalled();
  });
  it.each([
    "Saldo hadiah staf sudah berubah. Rekonsiliasi hadiah staf diperlukan",
    "Rangkaian aktivitas staf sudah berubah. Rekonsiliasi hadiah staf diperlukan",
    "Progres atau klaim hadiah staf sudah berubah. Rekonsiliasi hadiah staf diperlukan",
  ])("semua penjaga hadiah staf mendapat petunjuk yang sama: %s", async message => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } });
    const hasil = await batalkanPenjualan(form());
    expect((hasil as { message: string }).message).toMatch(/Tidak ada yang berubah/);
  });
  it("penolakan lain berSQLSTATE diteruskan apa adanya", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Periode sumber atau pembatalan sudah ditutup" } });
    expect(await batalkanPenjualan(form())).toEqual({ ok: false, outcome: "rejected", message: "Periode sumber atau pembatalan sudah ditutup" });
  });
  it("kunci terkunci / batas waktu (55P03): bisa dicoba lagi sebentar lagi", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "55P03", message: "canceling statement due to lock timeout" } });
    expect(await batalkanPenjualan(form())).toMatchObject({ ok: false, outcome: "retry" });
  });
  it("galat tanpa SQLSTATE (jaringan) tetap dilempar: hasilnya belum pasti", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "fetch failed" } });
    await expect(batalkanPenjualan(form())).rejects.toThrow("fetch failed");
  });
  it("jawaban kosong tanpa galat tetap dilempar (tidak diakui berhasil)", async () => {
    state.rpc.mockResolvedValue({ data: null, error: null });
    await expect(batalkanPenjualan(form())).rejects.toThrow(/belum terkonfirmasi/);
  });
  it("sukses tetap mengalihkan seperti semula", async () => {
    state.rpc.mockResolvedValue({ data: { voided: true }, error: null });
    await expect(batalkanPenjualan(form({ tindakan: "batal" }))).rejects.toThrow("success=cancelled");
  });
});

describe("Terima pembayaran / Batalkan penerimaan / Batalkan pencairan: penolakan pasti tidak disamarkan", () => {
  it("terima pembayaran ulang ditolak database: pesan aslinya tampil, kunci tahan-ulang tidak dikirim ulang oleh aksi", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Rekonsiliasi bank sudah mencakup rekening pembayaran sampai tanggal efektif (atau hari ini). Batalkan rekonsiliasinya dulu." } });
    const hasil = await terimaPembayaranUlang(form());
    expect(hasil).toEqual({ ok: false, outcome: "rejected", message: "Rekonsiliasi bank sudah mencakup rekening pembayaran sampai tanggal efektif (atau hari ini). Batalkan rekonsiliasinya dulu." });
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.revalidate).not.toHaveBeenCalled();
  });
  it("terima pembayaran ulang: kunci tabel jurnal 5 detik (55P03) = coba lagi", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "55P03", message: "canceling statement due to lock timeout" } });
    expect(await terimaPembayaranUlang(form())).toMatchObject({ ok: false, outcome: "retry" });
  });
  it("terima pembayaran ulang: galat tanpa SQLSTATE dan jawaban kosong tetap dilempar", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "fetch failed" } });
    await expect(terimaPembayaranUlang(form())).rejects.toThrow("fetch failed");
    state.rpc.mockResolvedValue({ data: null, error: null });
    await expect(terimaPembayaranUlang(form())).rejects.toThrow(/belum terkonfirmasi/);
  });
  it("terima pembayaran ulang: pesan hadiah staf TIDAK diganti (bukan jalur batal/ubah)", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: STAF } });
    expect(await terimaPembayaranUlang(form())).toEqual({ ok: false, outcome: "rejected", message: STAF });
  });
  it("batalkan penerimaan: penolakan pasti dikembalikan", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Sebagian uang struk ini sudah dikembalikan lewat retur/refund" } });
    expect(await batalkanPenerimaan(form())).toEqual({ ok: false, outcome: "rejected", message: "Sebagian uang struk ini sudah dikembalikan lewat retur/refund" });
    state.rpc.mockResolvedValue({ data: null, error: { message: "fetch failed" } });
    await expect(batalkanPenerimaan(form())).rejects.toThrow("fetch failed");
  });
  it("batalkan pencairan: penolakan pasti dikembalikan", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Pencairan sudah dibatalkan" } });
    expect(await batalkanPencairan(form())).toEqual({ ok: false, outcome: "rejected", message: "Pencairan sudah dibatalkan" });
  });
});
