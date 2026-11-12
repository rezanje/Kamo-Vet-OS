import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: fixture.rpc }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { ubahMetodeKwitansiKlinik } from "@/app/(app)/klinik/pembayaran/[visitId]/payment-correction-actions";
import { revalidatePath } from "next/cache";

const visitId = "f6000000-0000-4000-8000-000000000001";
const receiptId = "f7000000-0000-4000-8000-000000000001";
const partId = "f9000000-0000-4000-8000-000000000001";
function form(extra: Record<string, string> = {}) {
  const data = new FormData();
  Object.entries({ visitId, receiptId, partId, revision: "0", requestKey: "stable-key", alasan: "Pemilik bayar QRIS, kasir memilih Tunai", metode: "QRIS", ...extra })
    .forEach(([key, value]) => data.set(key, value));
  return data;
}
const ok = { receipt_id: receiptId, part_id: partId, to_method: "QRIS", audit_id: "audit", revision: 1 };

describe("ubahMetodeKwitansiKlinik", () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.rpc.mockResolvedValue({ data: ok, error: null }); });

  it("memanggil RPC kwitansi dengan kunci tahan-ulang lalu kembali ke halaman pembayaran", async () => {
    await expect(ubahMetodeKwitansiKlinik(form())).rejects.toThrow(`/klinik/pembayaran/${visitId}?success=ubah-metode-kwitansi`);
    expect(fixture.rpc).toHaveBeenCalledWith("correct_clinic_receipt_part_method", {
      p_receipt_id: receiptId, p_part_id: partId, p_request_key: "stable-key", p_reason: "Pemilik bayar QRIS, kasir memilih Tunai", p_new_method: "QRIS",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it.each(["Tunai", "Transfer", "Debit", "Kredit", "QRIS", "E-Wallet"])("menerima %s sebagai metode baru", async (metode) => {
    fixture.rpc.mockResolvedValue({ data: { ...ok, to_method: metode }, error: null });
    await expect(ubahMetodeKwitansiKlinik(form({ metode }))).rejects.toThrow(/success=ubah-metode-kwitansi/);
    expect(fixture.rpc).toHaveBeenCalledWith("correct_clinic_receipt_part_method", expect.objectContaining({ p_new_method: metode }));
  });

  it.each([["metode", "Kartu"], ["metode", "tunai"], ["metode", ""], ["alasan", "x"], ["alasan", "a".repeat(501)], ["requestKey", ""], ["partId", "bukan-uuid"], ["receiptId", ""], ["visitId", "x"]])(
    "menolak %s=%s sebelum RPC", async (field, value) => {
      await expect(ubahMetodeKwitansiKlinik(form({ [field]: value }))).rejects.toThrow(/tidak (valid|dikenal)/);
      expect(fixture.rpc).not.toHaveBeenCalled();
    });

  it("menampilkan penolakan database apa adanya, tanpa mengakui berhasil", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "ACCESS_DENIED: hanya Owner, Finance, atau peran yang diberi izin" } });
    await expect(ubahMetodeKwitansiKlinik(form())).rejects.toThrow(/ACCESS_DENIED/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([[{ receipt_id: "lain" }], [{ part_id: "lain" }], [{ to_method: "Debit" }], [{ audit_id: null }]])("tidak mengakui jawaban yang tidak cocok %j", async (patch) => {
    fixture.rpc.mockResolvedValue({ data: { ...ok, ...patch }, error: null });
    await expect(ubahMetodeKwitansiKlinik(form())).rejects.toThrow(/belum terkonfirmasi/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
