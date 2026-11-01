import { digitHp } from "@/lib/kontak";
import { normalPhone } from "@/lib/booking";

/**
 * Pencarian pelanggan di database (bukan di browser).
 *
 * Dulu tiap layar kasir/POS/CRM/form penjualan memuat SEMUA pelanggan (>10.000 baris,
 * ±20 permintaan per buka layar) lalu menyaring di browser. Itu membuat kasir lambat
 * sampai sempat tidak bisa dibuka (1 November 2026). Sekarang yang dikirim hanya
 * beberapa pelanggan yang cocok dengan ketikan.
 */
export const BATAS_HASIL_PELANGGAN = 8;
export const MIN_KETIK_PELANGGAN = 2;

/**
 * Buang karakter yang punya arti khusus di pola ILIKE / filter PostgREST. Titik dan
 * apostrof dibiarkan ("Bp. Andi", "D'Souza") — nilainya dikutip di filter.
 */
export function bersihkanKueriPelanggan(raw: string): string {
  return String(raw ?? "").replace(/[%_*,()\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/**
 * Regex Postgres yang cocok dengan deret angka walau di database ditulis "0812-3456-78"
 * atau "+62 858-..". Satu pemisah opsional per angka (`\D?`): `\D*` terbukti ±30x lebih
 * lambat di 10.000 pelanggan (backtracking).
 */
function regexAngka(digits: string): string {
  return digits.split("").join("\\D?");
}

/**
 * Filter `or=(...)` PostgREST untuk kata kunci pelanggan: nama (tidak peka huruf besar)
 * atau nomor HP. Nomor HP dicocokkan per angka (tanda baca diabaikan) dan setara
 * 08.. = 628.. = +62 8.., sama seperti pencarian lama di kasir.
 * Kembalian null = kata kunci terlalu pendek, jangan cari.
 */
export function filterCariPelanggan(raw: string): string | null {
  const kueri = bersihkanKueriPelanggan(raw);
  if (kueri.length < MIN_KETIK_PELANGGAN) return null;
  const syarat = [`name.ilike."*${kueri}*"`];
  const digits = digitHp(raw);
  if (digits.length >= 3) {
    const varian = new Set<string>([digits]);
    if (/^[\d\s()+.-]+$/.test(String(raw).trim())) {
      const lokal = normalPhone(digits); // 62.. -> 0..
      varian.add(lokal);
      if (lokal.startsWith("0")) varian.add(`62${lokal.slice(1)}`);
    }
    for (const v of varian) syarat.push(`phone.match.${regexAngka(v)}`);
  }
  return syarat.join(",");
}

export type PelangganDasar = { id: string; name: string; phone: string };
