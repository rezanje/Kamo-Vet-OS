// Pencarian pelanggan untuk layar kasir petshop.
//
// Latar (2026-11-01): pelanggan sudah >10.000. Layar kasir dulu memuat SEMUA pelanggan
// (plus semua penjualan & faktur untuk ringkasan transaksinya) setiap kali dibuka —
// ±1,7 MB per buka, dan tablet toko jadi macet. Sekarang layar hanya meminta
// pelanggan yang cocok dengan ketikan kasir, maksimal beberapa baris, dan ringkasan
// transaksinya dihitung untuk baris itu saja.
import type { createClient } from "@/lib/supabase/server";
import type { StatusUlasan } from "@/components/UlasanBadge";
import { digitHp } from "@/lib/kontak";
import { normalPhone } from "@/lib/booking";
import { isCompletedSale } from "@/lib/sale-payment-reporting";

type Db = Awaited<ReturnType<typeof createClient>>;
type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

export type CustRow = {
  id: string; name: string; phone: string; points: number; tier: string | null; kategori: string;
  trx: number; belanja: number;
  diskonPersen?: number;      // diskon DASAR golongan (customer_categories)
  rupiahPerPoin?: number;     // belanja sebesar ini = 1 poin
  golonganId?: string | null; // kunci ke pengecualian diskon per produk (0082)
  ulasan?: StatusUlasan | null; // status ulasan terkini (mis. "Bintang 1 Google")
};

/** Jumlah saran yang tampil di bawah kolom cari kasir. */
export const BATAS_SARAN_PELANGGAN = 5;
const BATAS_KANDIDAT = 25;

const KOLOM = "id, name, phone, points, tier, kategori, category_id, customer_categories(nama, diskon_persen, rupiah_per_poin, is_active), customer_review_statuses(nama, warna, nada)";
type CustRaw = {
  id: string; name: string; phone: string; points: number; tier: string | null; kategori: string;
  category_id: string | null;
  customer_categories: Rel<{ nama: string; diskon_persen: number; rupiah_per_poin: number; is_active: boolean }>;
  customer_review_statuses: Rel<{ nama: string; warna: string; nada: string }>;
};

/** Aturan cocok yang sama dengan pencarian kasir lama (nama tanpa beda huruf besar, HP 08../+62..). */
export function cocokPelanggan(c: { name: string; phone: string }, query: string): boolean {
  const s = query.trim().toLowerCase();
  if (!s) return false;
  const digits = digitHp(s);
  const localDigits = normalPhone(digits);
  const phoneQuery = /^[\d\s()+.-]+$/.test(s);
  const phone = digitHp(c.phone);
  return !!(digits && (phone.includes(digits) || (phoneQuery && normalPhone(phone).includes(localDigits))))
    || c.name.toLowerCase().includes(s);
}

/**
 * Pola regex nomor HP untuk database: nomor tersimpan bisa memakai pemisah
 * ("0812-1002-7879") atau awalan +62, jadi setiap digit boleh diselingi non-digit.
 * Hasil database disaring ulang dengan `cocokPelanggan`, jadi pola ini cukup lebar.
 */
export function polaHpPelanggan(query: string): string | null {
  const s = query.trim();
  const digits = digitHp(s);
  if (!digits) return null;
  const varian = new Set([digits]);
  if (/^[\d\s()+.-]+$/.test(s)) {
    const lokal = normalPhone(digits);
    varian.add(lokal);
    if (lokal.startsWith("0")) varian.add(`62${lokal.slice(1)}`);
  }
  return [...varian].map(v => v.split("").join("[^0-9]*")).join("|");
}

/** Escape karakter pola ILIKE supaya ketikan kasir dibaca apa adanya. */
function polaNama(query: string): string {
  return `%${query.trim().replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
}

/** Ringkasan transaksi (petshop selesai + faktur klinik lunas) hanya untuk pelanggan yang diminta. */
async function ringkasanTransaksi(supabase: Db, ids: string[]) {
  const trx = new Map<string, number>();
  const belanja = new Map<string, number>();
  if (ids.length === 0) return { trx, belanja };
  const [sales, invoices] = await Promise.all([
    supabase.from("sales").select("customer_id, total, payment_plan, payments_finalized_at, voided_at").in("customer_id", ids),
    supabase.from("invoices").select("total, visits!inner(customer_id)")
      .eq("paid_status", "Lunas").is("voided_at", null).in("visits.customer_id", ids),
  ]);
  if (sales.error || invoices.error) throw new Error("Ringkasan transaksi pelanggan belum dapat dimuat.");
  const tambah = (id: string | null | undefined, total: unknown) => {
    if (!id) return;
    trx.set(id, (trx.get(id) ?? 0) + 1);
    belanja.set(id, (belanja.get(id) ?? 0) + Number(total || 0));
  };
  for (const s of (sales.data ?? []).filter(isCompletedSale)) tambah(s.customer_id as string | null, s.total);
  for (const iv of (invoices.data ?? []) as unknown as { total: number; visits: Rel<{ customer_id: string | null }> }[]) {
    tambah(one(iv.visits)?.customer_id, iv.total);
  }
  return { trx, belanja };
}

async function keBarisKasir(supabase: Db, rows: CustRaw[]): Promise<CustRow[]> {
  const { trx, belanja } = await ringkasanTransaksi(supabase, rows.map(r => r.id));
  return rows.map((c) => {
    const gol = one(c.customer_categories);
    return {
      id: c.id, name: c.name, phone: c.phone, points: c.points, tier: c.tier,
      // Nama golongan dari master; kolom teks lama dipakai kalau belum dipetakan.
      kategori: gol?.nama ?? c.kategori,
      // Golongan nonaktif tidak memberi diskon — sama aturannya dengan server.
      diskonPersen: gol?.is_active ? Number(gol.diskon_persen) : 0,
      rupiahPerPoin: gol?.is_active ? Number(gol.rupiah_per_poin) : undefined,
      golonganId: gol?.is_active ? c.category_id : null,
      trx: trx.get(c.id) ?? 0, belanja: belanja.get(c.id) ?? 0,
      // Status ulasan ikut dibawa supaya kasir tahu siapa yang dia layani.
      ulasan: one(c.customer_review_statuses) ?? null,
    };
  });
}

/**
 * Baris pelanggan yang cocok dengan ketikan (nama / nomor HP), urut nama, maksimal
 * BATAS_SARAN_PELANGGAN. `kolom` wajib memuat id, name, phone. Dipakai kasir petshop
 * dan POS backoffice — keduanya tidak lagi memuat seluruh pelanggan.
 */
export async function cariBarisPelanggan<T extends { id: string; name: string; phone: string }>(
  supabase: Db, query: string, kolom: string,
): Promise<T[]> {
  const s = query.trim().slice(0, 80);
  if (!s) return [];
  const pola = polaHpPelanggan(s);
  const [byName, byPhone] = await Promise.all([
    supabase.from("customers").select(kolom).ilike("name", polaNama(s)).order("name").order("id").limit(BATAS_KANDIDAT),
    pola
      ? supabase.from("customers").select(kolom).filter("phone", "match", pola).order("name").order("id").limit(BATAS_KANDIDAT)
      : Promise.resolve({ data: [] as T[], error: null }),
  ]);
  if (byName.error || byPhone.error) throw new Error("Pencarian pelanggan gagal. Coba lagi.");
  const unik = new Map<string, T>();
  for (const row of [...(byName.data ?? []), ...(byPhone.data ?? [])] as unknown as T[]) {
    if (cocokPelanggan(row, s)) unik.set(row.id, row);
  }
  return [...unik.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "id") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, BATAS_SARAN_PELANGGAN);
}

/** Cari pelanggan untuk kasir petshop, lengkap dengan golongan & ringkasan transaksi. */
export async function cariPelangganKasir(supabase: Db, query: string): Promise<CustRow[]> {
  return keBarisKasir(supabase, await cariBarisPelanggan<CustRaw>(supabase, query, KOLOM));
}

/** Satu pelanggan lengkap untuk layar kasir (pulihkan draf, pelanggan baru). */
export async function ambilPelangganKasir(supabase: Db, id: string): Promise<CustRow | null> {
  if (!id) return null;
  const { data, error } = await supabase.from("customers").select(KOLOM).eq("id", id).maybeSingle();
  if (error) throw new Error("Data pelanggan belum dapat dimuat.");
  if (!data) return null;
  return (await keBarisKasir(supabase, [data as unknown as CustRaw]))[0] ?? null;
}
