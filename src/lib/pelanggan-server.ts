import type { createClient } from "@/lib/supabase/server";
import { BATAS_HASIL_PELANGGAN, filterCariPelanggan, type PelangganDasar } from "@/lib/pelanggan-cari";
import { isCompletedSale } from "@/lib/sale-payment-reporting";
import type { CustRow } from "@/app/kasir/KasirClient";
import type { Cust } from "@/app/(app)/pos/transaksi/PosClient";

type Db = Awaited<ReturnType<typeof createClient>>;
type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

export class PelangganGagalDimuat extends Error {}

// Pelanggan nonaktif (mis. akun penampung "CS pusat") tidak ditawarkan untuk transaksi baru.
// Kolom customers.is_active datang dari migrasi 20261107100000_pelanggan_nonaktif. Bila aplikasi
// sempat terdeploy sebelum migrasinya diterapkan (kolom belum ada, kode 42703), filter dilewati —
// perilaku lama — supaya pencarian pelanggan di kasir tidak ikut mati. Database tetap penjaga utama.
type HasilKueri<T> = { data: T | null; error: { code?: string } | null };
async function hanyaAktif<T>(jalankan: (aktifSaja: boolean) => PromiseLike<HasilKueri<T>>): Promise<HasilKueri<T>> {
  const hasil = await jalankan(true);
  return hasil.error?.code === "42703" ? jalankan(false) : hasil;
}

/** Beberapa pelanggan yang cocok dengan ketikan (nama / no. HP), urut nama. */
export async function cariPelangganDb(supabase: Db, kueri: string, limit = BATAS_HASIL_PELANGGAN): Promise<PelangganDasar[]> {
  const filter = filterCariPelanggan(kueri);
  if (!filter) return [];
  const { data, error } = await hanyaAktif((aktifSaja) => {
    const q = supabase.from("customers").select("id, name, phone");
    return (aktifSaja ? q.eq("is_active", true) : q).or(filter).order("name").order("id").limit(Math.max(1, Math.min(limit, 50)));
  });
  if (error) throw new PelangganGagalDimuat("Pencarian pelanggan gagal. Coba lagi.");
  return (data ?? []) as PelangganDasar[];
}

export async function muatPelangganDasar(supabase: Db, id: string): Promise<PelangganDasar | null> {
  // Pemuatan per id dipakai pemilih transaksi (memulihkan draf / setelah memilih): pelanggan
  // nonaktif dianggap tidak ada, sehingga layar meminta memilih ulang.
  const { data, error } = await hanyaAktif((aktifSaja) => {
    const q = supabase.from("customers").select("id, name, phone").eq("id", id);
    return (aktifSaja ? q.eq("is_active", true) : q).maybeSingle();
  });
  if (error) throw new PelangganGagalDimuat("Data pelanggan gagal dimuat. Coba lagi.");
  return (data ?? null) as PelangganDasar | null;
}

type Golongan = { nama: string; diskon_persen: number; rupiah_per_poin: number | null; is_active: boolean };

/** Data pelanggan yang dipakai layar kasir petshop untuk satu pelanggan terpilih. */
export async function muatPelangganKasir(supabase: Db, id: string): Promise<CustRow | null> {
  const [cust, sales, invoices] = await Promise.all([
    hanyaAktif((aktifSaja) => {
      const q = supabase.from("customers")
        .select("id, name, phone, points, tier, kategori, category_id, customer_categories(nama, diskon_persen, rupiah_per_poin, is_active), customer_review_statuses(nama, warna, nada)")
        .eq("id", id);
      return (aktifSaja ? q.eq("is_active", true) : q).maybeSingle();
    }),
    // Ringkasan transaksi (petshop + klinik lunas, semua waktu) dihitung hanya untuk
    // pelanggan ini — dulu seluruh tabel penjualan & invoice dibaca tiap kasir dibuka.
    supabase.from("sales").select("total, payment_plan, payments_finalized_at, voided_at").eq("customer_id", id),
    supabase.from("invoices").select("total, visits!inner(customer_id)")
      .eq("visits.customer_id", id).eq("paid_status", "Lunas").is("voided_at", null),
  ]);
  if (cust.error || sales.error || invoices.error) throw new PelangganGagalDimuat("Data pelanggan gagal dimuat. Coba lagi.");
  const c = cust.data as unknown as {
    id: string; name: string; phone: string; points: number; tier: string | null; kategori: string; category_id: string | null;
    customer_categories: Rel<Golongan>; customer_review_statuses: Rel<{ nama: string; warna: string; nada: string }>;
  } | null;
  if (!c) return null;
  let trx = 0, belanja = 0;
  for (const s of (sales.data ?? []).filter(isCompletedSale)) { trx++; belanja += Number(s.total || 0); }
  for (const iv of invoices.data ?? []) { trx++; belanja += Number(iv.total || 0); }
  const gol = one(c.customer_categories);
  return {
    id: c.id, name: c.name, phone: c.phone, points: Number(c.points) || 0, tier: c.tier,
    // Nama golongan dari master; kolom teks lama dipakai kalau belum dipetakan.
    kategori: gol?.nama ?? c.kategori,
    // Golongan nonaktif tidak memberi diskon — sama aturannya dengan server.
    diskonPersen: gol?.is_active ? Number(gol.diskon_persen) : 0,
    rupiahPerPoin: gol?.is_active ? Number(gol.rupiah_per_poin) : undefined,
    golonganId: gol?.is_active ? c.category_id : null,
    trx, belanja,
    ulasan: one(c.customer_review_statuses) ?? null,
  };
}

/** Data pelanggan untuk POS back-office/klinik (golongan + anabul). */
export async function muatPelangganPos(supabase: Db, id: string): Promise<Cust | null> {
  const { data, error } = await hanyaAktif((aktifSaja) => {
    const q = supabase.from("customers")
      .select("id, name, phone, points, category_id, customer_categories(nama, diskon_persen, rupiah_per_poin, is_active), pets(id, name, species)")
      .eq("id", id);
    return (aktifSaja ? q.eq("is_active", true) : q).maybeSingle();
  });
  if (error) throw new PelangganGagalDimuat("Data pelanggan gagal dimuat. Coba lagi.");
  const c = data as unknown as {
    id: string; name: string; phone: string; points: number; category_id: string | null;
    customer_categories: Rel<Golongan>; pets: { id: string; name: string; species: string | null }[] | null;
  } | null;
  if (!c) return null;
  const k = one(c.customer_categories);
  return {
    id: c.id, name: c.name, phone: c.phone, points: Number(c.points) || 0, pets: c.pets ?? [],
    golonganId: k?.is_active ? c.category_id : null,
    golongan: k?.is_active ? { nama: k.nama, diskon_persen: Number(k.diskon_persen), rupiah_per_poin: k.rupiah_per_poin == null ? null : Number(k.rupiah_per_poin) } : null,
  };
}
