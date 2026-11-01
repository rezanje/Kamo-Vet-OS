// Pencarian pelanggan untuk POS backoffice (/pos/transaksi). Sama alasannya dengan
// lib/kasir-pelanggan: pelanggan >10.000 tidak dimuat utuh ke layar; layar meminta
// yang cocok dengan ketikan saja, lengkap dengan hewan & golongannya.
import type { createClient } from "@/lib/supabase/server";
import { cariBarisPelanggan } from "@/lib/kasir-pelanggan";

type Db = Awaited<ReturnType<typeof createClient>>;

export type Pet = { id: string; name: string; species: string | null };
export type Cust = {
  id: string; name: string; phone: string; points: number; pets: Pet[];
  golonganId?: string | null;
  golongan: { nama: string; diskon_persen: number; rupiah_per_poin?: number | null } | null;
};

const KOLOM = "id, name, phone, points, category_id, customer_categories(nama, diskon_persen, rupiah_per_poin, is_active), pets(id, name, species)";
type CustomerCategory = { nama: string; diskon_persen: number; rupiah_per_poin: number | null; is_active: boolean };
type CustRaw = Omit<Cust, "golongan" | "golonganId"> & {
  category_id: string | null;
  customer_categories: CustomerCategory | CustomerCategory[] | null;
};

// Relasi Supabase bisa datang sebagai objek ATAU array — dinormalkan sekali di sini
// supaya kasir cukup baca satu bentuk (`golongan`).
function keCust(c: CustRaw): Cust {
  const k = Array.isArray(c.customer_categories) ? c.customer_categories[0] : c.customer_categories;
  return {
    id: c.id, name: c.name, phone: c.phone, points: Number(c.points) || 0, pets: c.pets ?? [],
    golonganId: k?.is_active ? c.category_id : null,
    golongan: k?.is_active ? { nama: k.nama, diskon_persen: Number(k.diskon_persen), rupiah_per_poin: k.rupiah_per_poin == null ? null : Number(k.rupiah_per_poin) } : null,
  };
}

export async function cariPelangganPos(supabase: Db, query: string): Promise<Cust[]> {
  return (await cariBarisPelanggan<CustRaw>(supabase, query, KOLOM)).map(keCust);
}

export async function ambilPelangganPos(supabase: Db, id: string): Promise<Cust | null> {
  if (!id) return null;
  const { data, error } = await supabase.from("customers").select(KOLOM).eq("id", id).maybeSingle();
  if (error) throw new Error("Data pelanggan belum dapat dimuat.");
  return data ? keCust(data as unknown as CustRaw) : null;
}
