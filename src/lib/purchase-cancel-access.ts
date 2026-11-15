/**
 * Siapa boleh membatalkan dokumen pembelian (penerimaan barang, faktur, pembayaran, uang muka).
 *
 * OWNER aktif SELALU penuh dan tidak pernah menunggu pembacaan kebijakan: bila pembacaan kebijakan gagal, Owner tetap boleh (gagal-terbuka
 * khusus Owner) sehingga tombol batal tidak hilang. Peran lain hanya boleh bila Owner memberi izinnya di Akses Grup (bawaan mati);
 * gagal baca = tidak boleh. Ini hanya soal tombol yang ditampilkan: database memeriksa ulang di setiap RPC (purchase_cancel_allowed).
 */
export const PURCHASE_CANCEL_ACTIONS = {
  penerimaan: "pembelian.batalkan_penerimaan",
  faktur: "pembelian.batalkan_faktur",
  pembayaran: "pembelian.batalkan_pembayaran",
  uangMuka: "pembelian.batalkan_uang_muka",
} as const;

export type PurchaseCancelAccess = { penerimaan: boolean; faktur: boolean; pembayaran: boolean; uangMuka: boolean };

export const NO_PURCHASE_CANCEL: PurchaseCancelAccess = { penerimaan: false, faktur: false, pembayaran: false, uangMuka: false };
export const FULL_PURCHASE_CANCEL: PurchaseCancelAccess = { penerimaan: true, faktur: true, pembayaran: true, uangMuka: true };

type AccessClient = { rpc(name: "get_my_purchase_cancel_access"): PromiseLike<{ data: unknown; error: unknown }> };
type ProfileLike = { role?: string | null; is_active?: boolean | null } | null | undefined;

export const isActiveOwner = (profile: ProfileLike): boolean => !!profile && profile.is_active === true && profile.role === "OWNER";

export async function loadPurchaseCancelAccess(client: AccessClient, profile: ProfileLike): Promise<PurchaseCancelAccess> {
  if (isActiveOwner(profile)) return FULL_PURCHASE_CANCEL;
  if (!profile || profile.is_active !== true) return NO_PURCHASE_CANCEL;
  try {
    const { data, error } = await client.rpc("get_my_purchase_cancel_access");
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return NO_PURCHASE_CANCEL;
    const v = data as Record<string, unknown>;
    return {
      penerimaan: v.batalkan_penerimaan === true,
      faktur: v.batalkan_faktur === true,
      pembayaran: v.batalkan_pembayaran === true,
      uangMuka: v.batalkan_uang_muka === true,
    };
  } catch {
    return NO_PURCHASE_CANCEL;
  }
}
