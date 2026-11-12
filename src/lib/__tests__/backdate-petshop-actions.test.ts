import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc }) }));
import { batalkanPencairan, batalkanPenerimaan, terimaPembayaranUlang } from "@/app/(app)/penjualan/[id]/actions";
import { hariIniWIB } from "@/lib/tanggal";

const id = "e8800000-0000-4000-8000-000000000002";
const hariIni = () => hariIniWIB();
const hariLalu = (n: number) => { const d = new Date(`${hariIni()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
function form(extra: Record<string, string> = {}) {
  const f = new FormData();
  Object.entries({ id, revision: "1", requestKey: "key-tgl", alasan: "Salah catat metode", konfirmasi: "ya", ...extra }).forEach(([k, v]) => f.set(k, v));
  return f;
}
beforeEach(() => vi.clearAllMocks());

describe("tanggal efektif: Batalkan penerimaan", () => {
  it("tanpa kolom tanggal (peran yang tak boleh mundur) = hari ini: RPC menerima null", async () => {
    state.rpc.mockResolvedValue({ data: { sale_id: id, unpaid: true, cancellation_id: "c1", effective_date: hariIni() }, error: null });
    await expect(batalkanPenerimaan(form())).rejects.toThrow(`/penjualan/${id}?success=receipt-cancelled&draft_scope=`);
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("cancel_pos_sale_receipt", { p_sale_id: id, p_expected_revision: 1, p_request_key: "key-tgl", p_reason: "Salah catat metode", p_effective_date: null });
  });
  it("tanggal asli dikirim apa adanya dan alamat sukses memuat penanda tanggal mundur", async () => {
    const d = hariLalu(2);
    state.rpc.mockResolvedValue({ data: { sale_id: id, unpaid: true, cancellation_id: "c1", effective_date: d }, error: null });
    await expect(batalkanPenerimaan(form({ tanggal: d }))).rejects.toThrow(`/penjualan/${id}?success=receipt-cancelled&tgl=${d}&draft_scope=`);
    expect(state.rpc).toHaveBeenCalledWith("cancel_pos_sale_receipt", expect.objectContaining({ p_effective_date: d }));
  });
  it("penanda tanggal digabung dengan penanda shift dengan urutan tetap", async () => {
    const d = hariLalu(1);
    state.rpc.mockResolvedValue({ data: { sale_id: id, unpaid: true, cancellation_id: "c1", effect_in_other_shift: true, effective_date: d }, error: null });
    await expect(batalkanPenerimaan(form({ tanggal: d }))).rejects.toThrow(`success=receipt-cancelled&shift=lain&tgl=${d}&draft_scope=`);
  });
  it.each(["2026-02-30", "12/11/2026", "kemarin", "2026-13-01", "20261112"])("tanggal tidak valid %s ditolak sebelum RPC", async value => {
    await expect(batalkanPenerimaan(form({ tanggal: value }))).rejects.toThrow(/Tanggal efektif tidak valid/);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("tanggal di masa depan ditolak sebelum RPC dengan kalimat jelas", async () => {
    const besok = hariLalu(-1);
    await expect(batalkanPenerimaan(form({ tanggal: besok }))).rejects.toThrow(/belum tiba/);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("penolakan database (periode tertutup, di luar rentang, bukan Owner) diteruskan apa adanya tanpa pengalihan sukses", async () => {
    for (const message of ["Periode akuntansi sampai 10/11/2026 sudah ditutup; tanggal efektif 09/11/2026 tidak bisa dibukukan. Pilih tanggal sesudah 10/11/2026 atau buka kembali periodenya lewat Tutup Buku.",
      "Tanggal efektif 01/11/2026 tidak boleh sebelum tanggal penerimaan yang dibatalkan (05/11/2026).",
      "Hanya Owner (atau peran yang diberi izin Tanggal mundur di Pengaturan > Akses Grup) yang boleh memilih tanggal sebelum hari ini. Pilih hari ini."]) {
      state.rpc.mockResolvedValue({ data: null, error: { message } });
      await expect(batalkanPenerimaan(form({ tanggal: hariLalu(3) }))).rejects.toThrow(message);
    }
    expect(state.revalidate).not.toHaveBeenCalled();
  });
});

describe("tanggal efektif: Terima pembayaran lagi", () => {
  beforeEach(() => state.rpc.mockResolvedValue({ data: { sale_id: id, unpaid: false, journal_id: "j1", effective_date: hariLalu(2) }, error: null }));
  it("tanggal mundur + alasan dikirim; alamat sukses memuat penanda", async () => {
    const d = hariLalu(2);
    await expect(terimaPembayaranUlang(form({ tanggal: d, alasan: "Dibayar di hari struk", amount_QRIS: "100000" }))).rejects.toThrow(`/penjualan/${id}?success=receipt-received&tgl=${d}&draft_scope=`);
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("receive_pos_sale_payment", { p_sale_id: id, p_expected_revision: 1, p_request_key: "key-tgl", p_plan: [{ method: "QRIS", amount: 100000 }], p_effective_date: d, p_reason: "Dibayar di hari struk" });
  });
  it("tanggal mundur tanpa alasan ditolak sebelum RPC; hari ini tanpa alasan boleh (alasan null)", async () => {
    await expect(terimaPembayaranUlang(form({ tanggal: hariLalu(1), alasan: "", amount_QRIS: "100000" }))).rejects.toThrow(/alasan tanggal efektif mundur/);
    await expect(terimaPembayaranUlang(form({ tanggal: hariLalu(1), alasan: "ab", amount_QRIS: "100000" }))).rejects.toThrow(/minimal 3 huruf/);
    expect(state.rpc).not.toHaveBeenCalled();
    state.rpc.mockResolvedValue({ data: { sale_id: id, unpaid: false, journal_id: "j1", effective_date: hariIni() }, error: null });
    await expect(terimaPembayaranUlang(form({ tanggal: hariIni(), alasan: "", amount_QRIS: "100000" }))).rejects.toThrow(`/penjualan/${id}?success=receipt-received&draft_scope=`);
    expect(state.rpc).toHaveBeenCalledWith("receive_pos_sale_payment", expect.objectContaining({ p_effective_date: hariIni(), p_reason: null }));
  });
  it("tanggal masa depan / tidak valid ditolak sebelum RPC", async () => {
    await expect(terimaPembayaranUlang(form({ tanggal: hariLalu(-2), amount_QRIS: "1" }))).rejects.toThrow(/belum tiba/);
    await expect(terimaPembayaranUlang(form({ tanggal: "abc", amount_QRIS: "1" }))).rejects.toThrow(/tidak valid/);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe("tanggal efektif: Batalkan pencairan marketplace", () => {
  it("tanggal asli dikirim; alamat sukses memuat penanda", async () => {
    const d = hariLalu(4);
    state.rpc.mockResolvedValue({ data: { sale_id: id, status: "piutang", cancellation_id: "o1", effective_date: d }, error: null });
    await expect(batalkanPencairan(form({ tanggal: d, alasan: "Nominal salah ketik" }))).rejects.toThrow(`/penjualan/${id}?success=disbursement-cancelled&tgl=${d}&draft_scope=`);
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("cancel_online_disbursement", { p_sale_id: id, p_expected_revision: 1, p_request_key: "key-tgl", p_reason: "Nominal salah ketik", p_effective_date: d });
  });
  it("tanggal masa depan ditolak sebelum RPC", async () => {
    await expect(batalkanPencairan(form({ tanggal: hariLalu(-1) }))).rejects.toThrow(/belum tiba/);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
