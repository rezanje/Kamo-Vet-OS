import { barisKontakKop } from "@/lib/cabang-identitas";

const BLUE = "var(--posb)";
export const KOP_NAMA_CADANGAN = "KAMO PET CARE";
export const KOP_TAGLINE = "WE CARE, THEY DESERVE";

/**
 * Sisi kiri kop rekam medis: logo + nama + baris kontak CABANG kunjungan.
 * - logo: logo cabang bila ada; kalau tidak, logo cakar bawaan.
 * - nama: nama cabang sungguhan; "KAMO PET CARE" hanya bila kunjungan tidak punya cabang (mis. impor lama).
 * - baris kecil: alamat · telepon bila diisi; kalau tidak, tagline lama.
 * Komponen murni (tanpa hook) agar bisa dipakai di halaman server maupun pratinjau di layar pengaturan.
 */
export function RekamMedisKop({ nama, alamat, telepon, logoUrl }: {
  nama?: string | null; alamat?: string | null; telepon?: string | null; logoUrl?: string | null;
}) {
  const namaTampil = nama?.trim() || KOP_NAMA_CADANGAN;
  const kontak = barisKontakKop({ alamat: alamat ?? null, telepon: telepon ?? null });
  return (
    <div data-kop="cabang" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img data-kop-logo src={logoUrl} alt="" style={{ width: 46, height: 46, objectFit: "contain", flexShrink: 0 }} />
      ) : (
        <div data-kop-logo-bawaan style={{ width: 46, height: 46, borderRadius: 10, background: BLUE, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-paw" style={{ fontSize: 24, color: "#fff" }} />
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div data-kop-nama style={{ fontSize: 16, fontWeight: 900, color: BLUE, lineHeight: 1.1 }}>{namaTampil}</div>
        {kontak
          ? <div data-kop-kontak style={{ fontSize: 8.5, color: "var(--tm)", lineHeight: 1.25, marginTop: 2 }}>{kontak}</div>
          : <div data-kop-tagline style={{ fontSize: 8.5, color: "var(--tm)", letterSpacing: ".08em" }}>{KOP_TAGLINE}</div>}
      </div>
    </div>
  );
}
