// Ubah pembayaran satu langkah (19 Nov 2026).
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc }) }));
import { ubahPembayaran } from "@/app/(app)/penjualan/[id]/actions";

const id = "e8800000-0000-4000-8000-000000000001";
function form(extra: Record<string, string> = {}) {
  const f = new FormData();
  Object.entries({ id, revision: "2", requestKey: "durable-key", alasan: "Pelanggan transfer", amount_Tunai: "", amount_Transfer: "100000", ...extra }).forEach(([k, v]) => f.set(k, v));
  return f;
}
beforeEach(() => { vi.clearAllMocks(); state.rpc.mockResolvedValue({ data: { sale_id: id, unpaid: false, mode: "ubah-pembayaran", journal_id: "j", effective_date: null }, error: null }); });

it("memanggil satu RPC atomik dengan rencana, tanggal, alasan, dan kunci tahan-ulang", async () => {
  await expect(ubahPembayaran(form({ tanggal: "2000-01-01" }))).rejects.toThrow(`/penjualan/${id}?success=payment-changed`);
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("change_pos_sale_payment", expect.objectContaining({
    p_sale_id: id, p_expected_revision: 2, p_request_key: "durable-key", p_reason: "Pelanggan transfer",
    p_plan: [{ method: "Transfer", amount: 100000 }], p_effective_date: "2000-01-01" }));
  expect(state.revalidate).toHaveBeenCalledWith("/", "layout");
});
it("tanpa kolom tanggal = hari ini (null), dan penolakan database tampil apa adanya", async () => {
  state.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "Tidak ada yang berubah" } });
  await expect(ubahPembayaran(form())).resolves.toMatchObject({ ok: false, outcome: "rejected", message: "Tidak ada yang berubah" });
  expect(state.rpc.mock.calls[0][1].p_effective_date).toBeNull();
});
it("menolak tanpa memanggil database bila alasan kosong atau tidak ada jumlah", async () => {
  await expect(ubahPembayaran(form({ alasan: "" }))).resolves.toMatchObject({ ok: false });
  await expect(ubahPembayaran(form({ amount_Transfer: "" }))).resolves.toMatchObject({ ok: false });
  expect(state.rpc).not.toHaveBeenCalled();
});
it("hasil tak lengkap dianggap belum pasti (lempar, isian tetap)", async () => {
  state.rpc.mockResolvedValueOnce({ data: { sale_id: id, unpaid: true }, error: null });
  await expect(ubahPembayaran(form())).rejects.toThrow("belum terkonfirmasi");
});
