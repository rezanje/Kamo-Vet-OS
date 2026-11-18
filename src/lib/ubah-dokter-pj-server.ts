import { loadServiceStaff } from "./service-performers-server";
import { bacaBolehUbahDokterPJ, pilihanDokterBaru, type PilihanDokterUbah } from "./ubah-dokter-pj";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type PanelUbahDokter = {
  /** Tombol "Ubah dokter" ditampilkan hanya bila true. */
  boleh: boolean;
  dokter: PilihanDokterUbah[];
};

export const PANEL_UBAH_DOKTER_TERSEMBUNYI: PanelUbahDokter = { boleh: false, dokter: [] };

/**
 * Bahan untuk tombol "Ubah dokter": izin (dibaca dari database lewat RPC; layar bukan otorisasi, database memeriksa ulang)
 * dan dokter yang bertugas di cabang kunjungan. Tidak membaca sesi/profil sendiri, jadi tidak menambah bacaan di layar yang memakainya.
 * Gagal baca APA PUN (termasuk izin tak terbaca) = tombol tersembunyi; layar lama berjalan persis seperti sebelumnya.
 */
export async function muatPanelUbahDokter(
  supabase: AnyClient,
  konteks: { branchId: string | null | undefined; dokterSekarang: string | null | undefined; staff?: readonly PilihanDokterUbah[] },
): Promise<PanelUbahDokter> {
  try {
    if (!konteks.branchId) return PANEL_UBAH_DOKTER_TERSEMBUNYI;
    if ((await bacaBolehUbahDokterPJ(supabase)) !== true) return PANEL_UBAH_DOKTER_TERSEMBUNYI;
    const staff = konteks.staff ?? ((await loadServiceStaff(supabase, konteks.branchId)) as PilihanDokterUbah[]);
    return { boleh: true, dokter: pilihanDokterBaru(staff, konteks.dokterSekarang) };
  } catch {
    return PANEL_UBAH_DOKTER_TERSEMBUNYI;
  }
}
