import type { ReactNode } from "react";
import { barisKontakKop } from "@/lib/cabang-identitas";

/**
 * Kop struk/kwitansi termal klinik (80 mm): nama cabang PENERBIT (gaya lama persis) + satu baris kecil
 * "alamat · Telp. telepon" bila diisi. Teks saja: tanpa logo agar kertas termal tetap pendek dan hitam-putih terbaca.
 * `children` = baris tambahan di bawah kop (mis. judul "KWITANSI PEMBAYARAN").
 */
export function KopStruk({ nama, alamat, telepon, children }: { nama: string; alamat?: string | null; telepon?: string | null; children?: ReactNode }) {
  const kontak = barisKontakKop({ alamat: alamat ?? null, telepon: telepon ?? null });
  return (
    <div data-kop-struk style={{ textAlign: "center", marginBottom: 6 }}>
      <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: ".05em" }}>{nama}</div>
      {kontak ? <div data-kop-struk-kontak style={{ fontSize: 9.5, lineHeight: 1.3, marginTop: 2 }}>{kontak}</div> : null}
      {children}
    </div>
  );
}
