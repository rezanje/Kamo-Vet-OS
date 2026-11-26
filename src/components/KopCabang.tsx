import { barisKontakKop } from "@/lib/cabang-identitas";

export const KOP_BIRU = "var(--posb)";

/**
 * Kop cabang bersama untuk dokumen cetak A4 klinik (rekam medis, invoice, resep, formulir persetujuan):
 * logo + nama + satu baris "alamat · telepon" milik CABANG PENERBIT dokumen.
 * - logo: logo cabang bila ada; kalau tidak, logo cakar bawaan (ukuran tetap 46x46 agar kop tetap satu halaman A4).
 * - baris kecil: alamat · telepon bila diisi; kalau keduanya kosong dan `tagline` diberikan, tagline itu; selain itu baris dihilangkan.
 * Komponen murni (tanpa hook): bisa dipakai di halaman server maupun pratinjau layar pengaturan.
 * `nama` sudah harus berupa teks final (nama cabang atau cadangan yang dipilih pemanggil).
 */
export function KopCabang({ nama, alamat, telepon, logoUrl, tagline = null, ukuranNama = 16, warnaNama = KOP_BIRU }: {
  nama: string; alamat?: string | null; telepon?: string | null; logoUrl?: string | null;
  tagline?: string | null; ukuranNama?: number; warnaNama?: string;
}) {
  const kontak = barisKontakKop({ alamat: alamat ?? null, telepon: telepon ?? null });
  return (
    <div data-kop="cabang" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img data-kop-logo src={logoUrl} alt="" style={{ width: 46, height: 46, objectFit: "contain", flexShrink: 0 }} />
      ) : (
        <div data-kop-logo-bawaan style={{ width: 46, height: 46, borderRadius: 10, background: KOP_BIRU, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-paw" style={{ fontSize: 24, color: "#fff" }} />
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div data-kop-nama style={{ fontSize: ukuranNama, fontWeight: 900, color: warnaNama, lineHeight: 1.1 }}>{nama}</div>
        {kontak
          ? <div data-kop-kontak style={{ fontSize: 8.5, color: "var(--tm)", lineHeight: 1.25, marginTop: 2 }}>{kontak}</div>
          : tagline ? <div data-kop-tagline style={{ fontSize: 8.5, color: "var(--tm)", letterSpacing: ".08em" }}>{tagline}</div> : null}
      </div>
    </div>
  );
}
