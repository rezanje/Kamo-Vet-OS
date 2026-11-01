import { readCompleteList } from "@/lib/checked-list";
import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Semua pelanggan, dibaca per halaman sampai habis. Satu permintaan ke database
 * dibatasi server (10.000 baris), dan pelanggan sudah melewati angka itu — tanpa
 * ini, pelanggan di luar batas tidak muncul di pilihan/pencarian.
 * Kembalian berbentuk `{ data }` supaya bisa menggantikan query biasa di Promise.all.
 */
export async function semuaPelanggan<T extends { id: string } = { id: string; name: string; phone: string }>(
  supabase: Db, columns: string, label = "Daftar pelanggan",
): Promise<{ data: T[] }> {
  const data = await readCompleteList<T>(async (from, to) => {
    const result = await supabase.from("customers").select(columns, { count: "exact" })
      .order("name").order("id").range(from, to);
    return { ...result, data: result.data as unknown as T[] | null };
  }, label, { maxRows: null });
  return { data };
}
