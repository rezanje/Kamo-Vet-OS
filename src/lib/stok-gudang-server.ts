// Pemuat data halaman Stok per Gudang (/pos/stok). Dipakai bersama oleh layar
// dan unduhan Excel/CSV supaya isi file selalu sama dengan yang tampil di layar
// (bedanya: unduhan memuat SEMUA baris, bukan satu halaman saja).
import type { createClient } from "@/lib/supabase/server";
import { readCompleteList } from "@/lib/checked-list";
import { pivotStokPerGudang, type StokBaris } from "@/lib/laporan";
import { polaCariStok, saringCariStok, type RingkasCariStok } from "@/lib/stok-cari";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

export type GudangStok = { id: string; code: string; name: string; type: string };
export type BarangStok = { id: string; code: string; name: string; unit: string | null };
/** `ringkasCari` terisi hanya bila ada pencarian: berapa yang cocok pas vs longgar. */
export type MatrixStok = ReturnType<typeof pivotStokPerGudang> & { ringkasCari?: RingkasCariStok | null };
export type BarisStokGudang = { id: string; code: string; name: string; unit: string; qty: number };

export async function bacaGudangAktif(supabase: Supabase): Promise<GudangStok[]> {
  return readCompleteList<GudangStok>(async (from, to) => {
    const result = await supabase.from("warehouses")
      .select("id, code, name, type", { count: "exact" })
      .eq("is_active", true).order("name").order("id").range(from, to);
    return { ...result, data: result.data as unknown as GudangStok[] | null };
  }, "Daftar gudang");
}

/** Matrix barang × gudang (ala laporan Persediaan per Gudang Accurate), sudah disaring `cari`.
 * `semua` = cocokan longgar (menempel di tengah kata/kode) ikut ditampilkan. */
export async function bacaMatrixStok(supabase: Supabase, cari: string, semua = false): Promise<MatrixStok> {
  type Sumber = { id: string; item_id: string; qty: number; warehouses: Rel<{ code: string }>; items: Rel<BarangStok> };
  const sumber = await readCompleteList<Sumber>(async (from, to) => {
    const result = await supabase.from("stock")
      .select("id, item_id, qty, warehouses(code), items(id, code, name, unit)", { count: "exact" })
      .order("id").range(from, to);
    return { ...result, data: result.data as unknown as Sumber[] | null };
  }, "Stok semua gudang");
  const rows: StokBaris[] = sumber.map((s) => {
    const it = one(s.items);
    return {
      item_id: s.item_id,
      code: it?.code ?? "—",
      name: it?.name ?? "—",
      unit: it?.unit ?? "",
      wh_code: one(s.warehouses)?.code ?? "?",
      qty: Number(s.qty),
    };
  });
  const matrix = pivotStokPerGudang(rows);
  if (!polaCariStok(cari)) return matrix;
  const { baris, ringkas } = saringCariStok(matrix.items, cari, (r) => r, semua);
  return { ...matrix, items: baris, ringkasCari: ringkas };
}

/** Semua stok satu gudang yang cocok dengan `cari`, yang paling pas di atas.
 * Database hanya mengambil calonnya (cocok longgar); yang tampil diputuskan
 * `saringCariStok`, sama persis dengan mode matrix. Dipakai layar dan unduhan. */
export async function cariStokGudang(supabase: Supabase, gudangId: string, cari: string, semua = false) {
  type Baris = { id: string; qty: number; items: Rel<BarangStok> };
  const pola = polaCariStok(cari);
  const semuaBaris = await readCompleteList<Baris>(async (from, to) => {
    let query = supabase.from("stock")
      .select(pola ? "id, qty, items!inner(id, code, name, unit)" : "id, qty, items(id, code, name, unit)", { count: "exact" })
      .eq("warehouse_id", gudangId);
    if (pola) query = query.or(`name.ilike.${pola},code.ilike.${pola}`, { referencedTable: "items" });
    const response = await query.order("updated_at", { ascending: false }).order("id").range(from, to);
    return { ...response, data: response.data as unknown as Baris[] | null };
  }, "Stok gudang");
  const rata: BarisStokGudang[] = semuaBaris.map((s) => {
    const it = one(s.items);
    return { id: s.id, code: it?.code ?? "—", name: it?.name ?? "—", unit: it?.unit ?? "", qty: Number(s.qty) };
  });
  return saringCariStok(rata, cari, (r) => r, semua);
}

/** Semua stok satu gudang (untuk unduhan), urutan sama dengan layar. */
export async function bacaSemuaStokGudang(supabase: Supabase, gudangId: string, cari: string, semua = false) {
  const { baris } = await cariStokGudang(supabase, gudangId, cari, semua);
  return baris.map(({ code, name, unit, qty }) => ({ code, name, unit, qty }));
}
