import { beforeEach, describe, expect, it, vi } from "vitest";

// Laporan Andri 17 Nov 2026: draf Pemindahan Barang yang dipulihkan membawa kunci simpan dokumen yang SUDAH
// tersimpan; database menjawab "Kunci pengiriman sudah dipakai" dan setiap tekan Simpan gagal lagi. Hanya
// aplikasi yang berubah: fungsi database tidak disentuh, jadi percobaan ulang identik tetap mengembalikan
// dokumen yang sama dan penolakan pasti kini DIKEMBALIKAN (galat yang dilempar disamarkan Next.js di produksi).
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: fixture.rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: fixture.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));

import { buatKirim, terimaBarang } from "@/app/(app)/pos/pemindahan/actions";
import { isStaleTransferKeyError, TRANSFER_KEY_REUSED_MESSAGE } from "@/lib/transfer-key";

const ITEMS = JSON.stringify([{ item_id: "11111111-1111-4111-8111-111111111111", qty: 22, satuan: "PCS" }]);
function form(extra: Record<string, string> = {}) {
  const data = new FormData();
  const base: Record<string, string> = {
    request_key: "kunci-lama", draft_key: "draf-1", draft_scope: "pos:pemindahan:baru", from_warehouse_id: "gudang-dc",
    to_warehouse_id: "gudang-wh", tanggal: "2026-11-17", keterangan: "", items: ITEMS, ...extra,
  };
  for (const [k, v] of Object.entries(base)) data.set(k, v);
  return data;
}
beforeEach(() => { fixture.rpc.mockReset(); fixture.revalidate.mockReset(); });

describe("kunci pengiriman yang basi (Kirim Barang)", () => {
  it("dikembalikan sebagai penolakan pasti: BELUM tersimpan, kunci diganti, tanpa redirect/revalidasi", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "Kunci pengiriman sudah dipakai" } });
    const result = await buatKirim(form());
    expect(result).toMatchObject({ ok: false, outcome: "rejected", code: "stale_request_key" });
    expect(result.message).toBe("Kunci simpan lama sudah dipakai dokumen lain. Pemindahan ini BELUM tersimpan. Kunci sudah diganti otomatis; periksa isian lalu tekan Simpan sekali lagi.");
    expect(fixture.revalidate).not.toHaveBeenCalled();
  });

  it("Terima Barang memakai kata 'Penerimaan' pada pesan yang sama", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "Kunci pengiriman sudah dipakai" } });
    const result = await terimaBarang(form({ source_transfer_id: "dok-kirim" }));
    expect(result).toMatchObject({ ok: false, code: "stale_request_key" });
    expect(result.message).toMatch(/Penerimaan ini BELUM tersimpan/);
  });

  it("kunci dari formulir diteruskan apa adanya ke database (tidak dibuat ulang di server)", async () => {
    fixture.rpc.mockResolvedValue({ data: "dok-1", error: null });
    await expect(buatKirim(form({ request_key: "kunci-x" }))).rejects.toThrow();
    expect(fixture.rpc).toHaveBeenCalledWith("post_stock_transfer_atomic", expect.objectContaining({ p_key: "kunci-x", p_from: "gudang-dc", p_to: "gudang-wh" }));
  });

  it("percobaan ulang identik (kunci sama, isian sama) tetap mengembalikan dokumen yang sama", async () => {
    fixture.rpc.mockResolvedValue({ data: "dok-397", error: null });
    for (let i = 0; i < 2; i++) {
      await expect(buatKirim(form())).rejects.toThrow("REDIRECT:/pos/pemindahan/dok-397?success=");
    }
    expect(fixture.rpc.mock.calls.map(c => c[1].p_key)).toEqual(["kunci-lama", "kunci-lama"]);
  });

  it("simpan sukses tetap redirect ke dokumen + pengakuan draf", async () => {
    fixture.rpc.mockResolvedValue({ data: "dok-9", error: null });
    await expect(buatKirim(form())).rejects.toThrow(/REDIRECT:\/pos\/pemindahan\/dok-9\?success=.*draft_done=draf-1&draft_scope=pos%3Apemindahan%3Abaru/);
    expect(fixture.revalidate).toHaveBeenCalledWith("/pos/pemindahan");
  });

  it("galat database lain tetap redirect dengan pesannya (tidak ikut dianggap kunci basi)", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "Gudang asal tidak aktif" } });
    await expect(buatKirim(form())).rejects.toThrow("REDIRECT:/pos/pemindahan/baru?error=Gudang%20asal%20tidak%20aktif");
  });

  it.each([
    "Kunci pengiriman sudah dipakai.", "kunci pengiriman sudah dipakai", " Kunci pengiriman sudah dipakai",
    "Kunci pengiriman sudah dipakai untuk dokumen lain", "Kunci pembatalan sudah dipakai untuk dokumen lain. Muat ulang halaman",
  ])("pesan mirip tetapi tidak persis (%s) bukan penolakan kunci basi", async message => {
    expect(isStaleTransferKeyError(message)).toBe(false);
    fixture.rpc.mockResolvedValue({ data: null, error: { message } });
    await expect(buatKirim(form())).rejects.toThrow(/REDIRECT:\/pos\/pemindahan\/baru\?error=/);
  });

  it("pesan persis cocok", () => expect(isStaleTransferKeyError(TRANSFER_KEY_REUSED_MESSAGE)).toBe(true));
});
