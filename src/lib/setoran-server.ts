import "server-only";
import { createClient } from "@/lib/supabase/server";
import { bacaDaftar, bacaDetail, bacaRekap, pesanSetoran, type BarisDaftar, type DetailSetoran, type RekapSetoran } from "@/lib/setoran";

// Pembaca data Rekap Setoran. Semua lewat RPC SECURITY DEFINER yang membentuk hasil menurut peran (privasi ditegakkan di basis data).
type Supabase = Awaited<ReturnType<typeof createClient>>;
export type Akses = { masuk: boolean; penyetuju: boolean; pemutus: boolean; void: boolean; role: string | null };
export type FilterDaftar = { dari: string; sampai: string; branch: string | null; status: string | null; kasir: string | null };
export const STATUS_FILTER = ["Draft", "Diajukan", "Disetujui", "Ditolak", "Void"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TGL = /^\d{4}-\d{2}-\d{2}$/;

export async function muatAkses(supabase: Supabase): Promise<Akses> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { masuk: false, penyetuju: false, pemutus: false, void: false, role: null };
  const [{ data }, { data: prof }] = await Promise.all([
    supabase.rpc("setoran_akses"),
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
  ]);
  const a = (data ?? {}) as { masuk?: boolean; penyetuju?: boolean; pemutus?: boolean; void?: boolean };
  return { masuk: a.masuk === true, penyetuju: a.penyetuju === true, pemutus: a.penyetuju === true && a.pemutus === true, void: a.void === true, role: (prof as { role?: string } | null)?.role ?? null };
}

/** Saringan dari alamat: nilai tidak sah dibuang diam-diam ke bawaan (bulan berjalan). */
export function bacaSaringan(sp: Record<string, string | undefined>, hariIni: string): FilterDaftar {
  const awalBulan = `${hariIni.slice(0, 7)}-01`;
  return {
    dari: sp.dari && TGL.test(sp.dari) ? sp.dari : awalBulan,
    sampai: sp.sampai && TGL.test(sp.sampai) ? sp.sampai : hariIni,
    branch: sp.branch && UUID.test(sp.branch) ? sp.branch : null,
    status: sp.status && (STATUS_FILTER as readonly string[]).includes(sp.status) ? sp.status : null,
    kasir: sp.kasir && UUID.test(sp.kasir) ? sp.kasir : null,
  };
}

export async function muatDaftar(supabase: Supabase, f: FilterDaftar): Promise<{ penyetuju: boolean; baris: BarisDaftar[] }> {
  const { data, error } = await supabase.rpc("setoran_daftar", { p_dari: f.dari, p_sampai: f.sampai, p_branch: f.branch, p_status: f.status, p_kasir: f.kasir });
  if (error) throw new Error(pesanSetoran(error.message));
  return bacaDaftar(data);
}

export async function muatDetail(supabase: Supabase, id: string): Promise<DetailSetoran> {
  const { data, error } = await supabase.rpc("setoran_detail", { p_id: id });
  if (error) throw new Error(pesanSetoran(error.message));
  return bacaDetail(data);
}

export async function muatRekap(supabase: Supabase, f: FilterDaftar): Promise<RekapSetoran> {
  const { data, error } = await supabase.rpc("setoran_rekap", { p_dari: f.dari, p_sampai: f.sampai, p_branch: f.branch, p_status: f.status, p_kasir: f.kasir });
  if (error) throw new Error(pesanSetoran(error.message));
  return bacaRekap(data);
}

export async function muatRekening(supabase: Supabase, branch: string) {
  const { data } = await supabase.rpc("setoran_rekening_tujuan", { p_branch: branch });
  return ((data ?? []) as { id: string; nama: string; jenis: string; bank?: string | null }[]).map((r) => ({ id: String(r.id), nama: String(r.nama), jenis: String(r.jenis), bank: r.bank ?? null }));
}

export async function muatSoTerakhir(supabase: Supabase, branch: string) {
  const { data } = await supabase.rpc("setoran_so_terakhir", { p_branch: branch });
  return (data ?? null) as { ada: boolean; no_hasil?: string; tanggal?: string; order_id?: string; nilai_jual_kurang?: number | null; nilai_jual_lebih?: number | null } | null;
}

/** Cabang yang boleh dipilih akun ini (RLS branches). */
export async function muatCabang(supabase: Supabase): Promise<{ id: string; code: string; name: string }[]> {
  const { data } = await supabase.from("branches").select("id, code, name").eq("is_active", true).order("code");
  return ((data ?? []) as { id: string; code: string; name: string }[]);
}

export async function muatKaryawan(supabase: Supabase): Promise<{ id: string; nama: string }[]> {
  const { data } = await supabase.from("employees").select("id, nama").eq("status", "Aktif").is("trashed_at", null).order("nama").limit(1000);
  return ((data ?? []) as { id: string; nama: string }[]);
}
