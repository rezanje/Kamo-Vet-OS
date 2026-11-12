import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc }) }));
import { batalkanPencairan, batalkanPenerimaan, terimaPembayaranUlang } from "@/app/(app)/penjualan/[id]/actions";

const id = "e8800000-0000-4000-8000-000000000001";
function form(extra: Record<string, string> = {}) {
  const f = new FormData();
  Object.entries({ id, revision: "2", requestKey: "durable-key", alasan: "Pelanggan bayar QRIS", konfirmasi: "ya", ...extra }).forEach(([k, v]) => f.set(k, v));
  return f;
}
beforeEach(() => vi.clearAllMocks());

describe("batalkanPenerimaan", () => {
  beforeEach(() => state.rpc.mockResolvedValue({ data: { sale_id: id, unpaid: true, cancellation_id: "c1", effect_in_other_shift: false }, error: null }));
  it("memanggil RPC atomik dengan revisi, alasan, dan kunci tahan-ulang, lalu mengarahkan dengan kunci draf", async () => {
    await expect(batalkanPenerimaan(form())).rejects.toThrow(`/penjualan/${id}?success=receipt-cancelled&draft_scope=${encodeURIComponent(`sale-receipt-cancel:${id}:2`)}&draft_done=durable-key`);
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("cancel_pos_sale_receipt", { p_sale_id: id, p_expected_revision: 2, p_request_key: "durable-key", p_reason: "Pelanggan bayar QRIS" });
    expect(state.revalidate).toHaveBeenCalledWith("/", "layout");
  });
  it("melaporkan bila koreksi jatuh di shift lain (shift asal sudah tertutup)", async () => {
    state.rpc.mockResolvedValue({ data: { sale_id: id, unpaid: true, cancellation_id: "c1", effect_in_other_shift: true }, error: null });
    await expect(batalkanPenerimaan(form())).rejects.toThrow("success=receipt-cancelled&shift=lain");
  });
  it("melaporkan 'tanpa shift' bila pelaku tidak punya shift terbuka (tidak menyebut shift lain)", async () => {
    state.rpc.mockResolvedValue({ data: { sale_id: id, unpaid: true, cancellation_id: "c1", effect_in_other_shift: false, shift_mode: "tanpa_shift", effect_shift_id: null }, error: null });
    await expect(batalkanPenerimaan(form())).rejects.toThrow("success=receipt-cancelled&shift=tanpa");
  });
  it("shift asal terbuka / shift pelaku / nonkas: tidak ada tanda tambahan kecuali 'lain' untuk shift pelaku", async () => {
    for (const shift_mode of ["shift_asal_terbuka", "nonkas"]) {
      state.rpc.mockResolvedValue({ data: { sale_id: id, unpaid: true, cancellation_id: "c1", effect_in_other_shift: false, shift_mode }, error: null });
      await expect(batalkanPenerimaan(form())).rejects.toThrow(new RegExp(`/penjualan/${id}\\?success=receipt-cancelled&draft_scope=`));
    }
  });
  it("tanpa konfirmasi tercentang atau tanpa alasan: ditolak sebelum RPC dengan pesan Indonesia", async () => {
    await expect(batalkanPenerimaan(form({ konfirmasi: "" }))).rejects.toThrow(/Centang kotak konfirmasi/);
    await expect(batalkanPenerimaan(form({ alasan: " a " }))).rejects.toThrow(/minimal 3 huruf/);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each([["revision", "-1"], ["revision", "NaN"], ["revision", ""], ["id", "bukan-uuid"], ["requestKey", ""], ["requestKey", "k".repeat(121)]])("menolak isian tidak valid %s=%s sebelum RPC", async (name, value) => {
    await expect(batalkanPenerimaan(form({ [name]: value }))).rejects.toThrow(/Identitas penjualan/);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("pesan penolakan database diteruskan apa adanya (petunjuk jelas) dan tidak ada pengalihan sukses", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "Sebagian uang struk ini sudah dikembalikan lewat retur/refund" } });
    await expect(batalkanPenerimaan(form())).rejects.toThrow("Sebagian uang struk ini sudah dikembalikan");
    expect(state.revalidate).not.toHaveBeenCalled();
  });
  it("jawaban tak terkonfirmasi (kosong / belum 'unpaid' / id lain) tidak diakui berhasil", async () => {
    for (const data of [null, { sale_id: id, unpaid: false, cancellation_id: "c" }, { sale_id: "lain", unpaid: true, cancellation_id: "c" }, { sale_id: id, unpaid: true }]) {
      state.rpc.mockResolvedValue({ data, error: null });
      await expect(batalkanPenerimaan(form())).rejects.toThrow(/belum terkonfirmasi/);
    }
    expect(state.revalidate).not.toHaveBeenCalled();
  });
});

describe("terimaPembayaranUlang", () => {
  beforeEach(() => state.rpc.mockResolvedValue({ data: { sale_id: id, unpaid: false, journal_id: "j1" }, error: null }));
  it("menyusun rencana dari kolom yang terisi (kosong = 0), semua enam metode didukung, jumlah persis", async () => {
    const f = form({ amount_Tunai: "25000.50", amount_Transfer: "", amount_Debit: "10000", amount_Kredit: "0", amount_QRIS: "64999.50", "amount_E-Wallet": "0.00" });
    await expect(terimaPembayaranUlang(f)).rejects.toThrow(`/penjualan/${id}?success=receipt-received&draft_scope=${encodeURIComponent(`sale-receipt-receive:${id}:2`)}&draft_done=durable-key`);
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("receive_pos_sale_payment", {
      p_sale_id: id, p_expected_revision: 2, p_request_key: "durable-key",
      p_plan: [{ method: "Tunai", amount: 25000.5 }, { method: "Debit", amount: 10000 }, { method: "QRIS", amount: 64999.5 }],
    });
  });
  it("terima ulang tunai tanpa shift terbuka: ditandai 'tanpa shift' di pengalihan", async () => {
    state.rpc.mockResolvedValue({ data: { sale_id: id, unpaid: false, journal_id: "j1", shift_mode: "tanpa_shift" }, error: null });
    await expect(terimaPembayaranUlang(form({ amount_Tunai: "100000" }))).rejects.toThrow(`/penjualan/${id}?success=receipt-received&shift=tanpa&draft_scope=`);
  });
  it("semua metode kosong: ditolak sebelum RPC", async () => {
    await expect(terimaPembayaranUlang(form())).rejects.toThrow(/minimal satu metode/);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each(["-1", "1.001", "NaN", "Infinity", "1e5", "1000000000001"])("jumlah tidak valid %s ditolak sebelum RPC", async value => {
    await expect(terimaPembayaranUlang(form({ amount_Tunai: value }))).rejects.toThrow(/tidak valid/);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("kegagalan database diteruskan; jawaban tak terkonfirmasi tidak diakui", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "Rincian pembayaran harus 1 sampai 6 metode berbeda" } });
    await expect(terimaPembayaranUlang(form({ amount_Tunai: "100" }))).rejects.toThrow("Rincian pembayaran harus 1 sampai 6 metode berbeda");
    state.rpc.mockResolvedValue({ data: { sale_id: id, unpaid: true }, error: null });
    await expect(terimaPembayaranUlang(form({ amount_Tunai: "100" }))).rejects.toThrow(/belum terkonfirmasi/);
    expect(state.revalidate).not.toHaveBeenCalled();
  });
});

describe("batalkanPencairan", () => {
  beforeEach(() => state.rpc.mockResolvedValue({ data: { sale_id: id, status: "piutang", cancellation_id: "o1" }, error: null }));
  it("memanggil RPC pembatalan pencairan dan mengarahkan ke detail order", async () => {
    await expect(batalkanPencairan(form({ alasan: "Nominal salah ketik" }))).rejects.toThrow(`/penjualan/${id}?success=disbursement-cancelled`);
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("cancel_online_disbursement", { p_sale_id: id, p_expected_revision: 2, p_request_key: "durable-key", p_reason: "Nominal salah ketik" });
  });
  it("wajib konfirmasi dan alasan; jawaban salah tidak diakui", async () => {
    await expect(batalkanPencairan(form({ konfirmasi: "" }))).rejects.toThrow(/Centang kotak konfirmasi/);
    await expect(batalkanPencairan(form({ alasan: "" }))).rejects.toThrow(/minimal 3 huruf/);
    state.rpc.mockResolvedValue({ data: { sale_id: id, status: "cair" }, error: null });
    await expect(batalkanPencairan(form())).rejects.toThrow(/belum terkonfirmasi/);
  });
});
