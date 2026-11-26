import type { SupabaseClient } from "@supabase/supabase-js";
import { LOGO_BUCKET, jalurLogoSah } from "@/lib/cabang-identitas";

export type IdentitasKop = { alamat: string | null; telepon: string | null; logoUrl: string | null };

const TEKS = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/**
 * Identitas kop (alamat, telepon, logo) untuk dokumen cetak klinik, dari cabang PENERBIT dokumen (branchId yang
 * tersimpan pada kunjungan/tagihan), bukan cabang yang sedang dipilih pengguna. Dipakai bersama oleh rekam medis,
 * invoice, resep, dan formulir persetujuan agar aturannya satu.
 *
 * Tidak pernah melempar galat: identitas bersifat pelengkap, jadi gagal baca, belum diisi, atau gagal membuat tautan
 * logo berarti bagian itu kosong dan dokumen tetap tercetak dengan nama cabang. Gagal membuat tautan logo hanya
 * menghilangkan logo (alamat dan telepon tetap tampil). Tanpa branchId tidak ada pembacaan sama sekali.
 */
export async function bacaIdentitasKop(supabase: SupabaseClient, branchId: string | null | undefined): Promise<IdentitasKop> {
  const kosong: IdentitasKop = { alamat: null, telepon: null, logoUrl: null };
  if (!branchId) return kosong;
  try {
    const { data } = await supabase.from("branches").select("alamat, telepon, logo_path").eq("id", branchId).maybeSingle();
    const idn = (data && typeof data === "object" && !Array.isArray(data) ? data : null) as { alamat?: unknown; telepon?: unknown; logo_path?: unknown } | null;
    const hasil: IdentitasKop = { alamat: TEKS(idn?.alamat), telepon: TEKS(idn?.telepon), logoUrl: null };
    const logoPath = typeof idn?.logo_path === "string" ? idn.logo_path : null;
    if (logoPath && jalurLogoSah(branchId, logoPath)) {
      try {
        const { data: signed } = await supabase.storage.from(LOGO_BUCKET).createSignedUrl(logoPath, 3600);
        hasil.logoUrl = TEKS(signed?.signedUrl);
      } catch { /* tanpa logo; alamat dan telepon tetap */ }
    }
    return hasil;
  } catch {
    return kosong;
  }
}
