import { amankanSel } from "@/lib/laporan-kategori-penjualan";
import { periksaAksesStok } from "@/lib/stok-analisis-server";
import { hariIniWIB } from "@/lib/tanggal";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

export const HALAMAN_BAWAH_MODAL = "/laporan/jual-bawah-modal";
const PERAN_LAPORAN = ["OWNER", "ADMIN", "FINANCE"] as const;

export type BarisBawahModal = {
  sale_id: string; tanggal: string; cabang_id: string; cabang: string | null; no_struk: string; item_id: string; kode: string | null; barang: string;
  qty: number; satuan: string | null; faktor: number; hpp: number; harga_neto: number; rugi: number; alasan: string; oleh_id: string | null; oleh: string;
};

/** Halaman dan unduhan: peran OWNER/ADMIN/FINANCE aktif DAN sub-menu diizinkan Akses Grup (fail-closed). Database memeriksa peran lagi di fungsi laporan. */
export async function periksaAksesBawahModal(client: Client): Promise<boolean> {
  const akses = await periksaAksesStok(client, HALAMAN_BAWAH_MODAL);
  return akses.ok && !!akses.role && (PERAN_LAPORAN as readonly string[]).includes(akses.role);
}

const TGL = /^\d{4}-\d{2}-\d{2}$/;
export function rentangBawahModal(params: { dari?: string | null; sampai?: string | null }): { dari: string; sampai: string } {
  const hariIni = hariIniWIB();
  const sampai = params.sampai && TGL.test(params.sampai) ? params.sampai : hariIni;
  const awalBulan = `${hariIni.slice(0, 8)}01`;
  const dari = params.dari && TGL.test(params.dari) ? params.dari : awalBulan;
  return dari <= sampai ? { dari, sampai } : { dari: sampai, sampai: dari };
}

export async function muatCabangLaporan(client: Client): Promise<{ id: string; name: string }[]> {
  const { data, error } = await client.from("branches").select("id, name").eq("is_active", true).order("name");
  if (error) throw new Error("Daftar cabang belum dapat dimuat.");
  return (data ?? []) as { id: string; name: string }[];
}

export async function muatBawahModal(client: Client, dari: string, sampai: string, cabang: string): Promise<BarisBawahModal[]> {
  const { data, error } = await client.rpc("laporan_jual_bawah_modal", { p_dari: dari, p_sampai: sampai, p_cabang: cabang || null });
  if (error) throw new Error(error.message.includes("Hanya Owner") ? "Laporan ini hanya untuk Owner, Admin, atau Finance." : "Laporan belum dapat dimuat. Coba lagi.");
  const baris = (data as { baris?: BarisBawahModal[] } | null)?.baris;
  if (!Array.isArray(baris)) throw new Error("Laporan belum dapat dimuat. Coba lagi.");
  return baris.map((b) => ({ ...b, qty: Number(b.qty), faktor: Number(b.faktor), hpp: Number(b.hpp), harga_neto: Number(b.harga_neto), rugi: Number(b.rugi) }));
}

export const KOLOM_BAWAH_MODAL = ["Tanggal", "Cabang", "Struk", "Kode", "Barang", "Qty", "Satuan", "HPP (Rp)", "Harga neto (Rp)", "Rugi (Rp)", "Alasan", "Oleh"] as const;

/** Satu baris Excel; teks diberi tanda petik bila diawali rumus (amankanSel). */
export function barisExcelBawahModal(b: BarisBawahModal): (string | number)[] {
  return [b.tanggal, b.cabang ?? "", b.no_struk, b.kode ?? "", b.barang, b.qty, b.satuan ?? "", b.hpp, b.harga_neto, b.rugi, b.alasan, b.oleh].map(amankanSel);
}

export function totalRugi(baris: readonly BarisBawahModal[]): number {
  return Math.round(baris.reduce((jumlah, b) => jumlah + b.rugi, 0) * 100) / 100;
}
