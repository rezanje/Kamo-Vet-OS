import { KopCabang } from "@/components/KopCabang";

export const KOP_NAMA_CADANGAN = "KAMO PET CARE";
export const KOP_TAGLINE = "WE CARE, THEY DESERVE";

/**
 * Sisi kiri kop dokumen klinik (rekam medis, resep, formulir persetujuan): logo + nama + baris kontak CABANG kunjungan.
 * - logo: logo cabang bila ada; kalau tidak, logo cakar bawaan.
 * - nama: nama cabang sungguhan; "KAMO PET CARE" hanya bila kunjungan tidak punya cabang (mis. impor lama).
 * - baris kecil: alamat · telepon bila diisi; kalau tidak, tagline lama.
 * Tampilannya dipegang KopCabang (dipakai juga oleh invoice); komponen ini hanya menetapkan cadangan nama dan tagline.
 */
export function RekamMedisKop({ nama, alamat, telepon, logoUrl }: {
  nama?: string | null; alamat?: string | null; telepon?: string | null; logoUrl?: string | null;
}) {
  return <KopCabang nama={nama?.trim() || KOP_NAMA_CADANGAN} alamat={alamat} telepon={telepon} logoUrl={logoUrl} tagline={KOP_TAGLINE} />;
}
