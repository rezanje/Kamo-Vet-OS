// Pembaca/penulis sisi server untuk Komplain Pelanggan. Semua hak akses (cabang, pembuat/petugas, izin kelola, Admin Online ditolak) dan semua hitungan
// ada di fungsi database `komplain_*` (migrasi 20261211100000); di sini hanya memanggil RPC, memeriksa bentuk hasil, dan menerjemahkan galat.
// Tidak ada jurnal, uang, atau stok yang disentuh.
import {
  FUNGSI_KOMPLAIN, UKURAN_HALAMAN, bacaDaftar, bacaDashboard, bacaDetail, bacaKategori, bacaPilihan, pesanGalatKomplain, paramSaringan, adalahUuid,
  type Dashboard, type DetailKomplain, type FilterKomplain, type HasilDaftar, type HasilKategori, type Pilihan,
} from "./komplain";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export class KomplainError extends Error {}

function galat(error: { code?: string; message?: string }, bawaan: string): KomplainError {
  if (error.code === "PGRST202" || error.code === "42883") return new KomplainError("Fitur komplain belum terpasang di database.");
  if (/ADMIN_ONLINE_FUNCTION_DENIED|KOMPLAIN_DITOLAK/.test(error.message ?? "")) return new KomplainError("Akun ini tidak boleh memakai Komplain Pelanggan.");
  if (/KOMPLAIN_TIDAK_ADA/.test(error.message ?? "")) return new KomplainError(pesanGalatKomplain(error.message));
  return new KomplainError(bawaan);
}

export async function muatPilihan(client: AnyClient, cabang: string | null = null): Promise<Pilihan> {
  const { data, error } = await client.rpc(FUNGSI_KOMPLAIN.pilihan, { p_branch: cabang && adalahUuid(cabang) ? cabang : null });
  if (error) throw galat(error, "Pilihan formulir belum dapat dimuat. Muat ulang sebentar lagi.");
  const p = bacaPilihan(data);
  if (!p) throw new KomplainError("Pilihan formulir belum dapat dibaca lengkap. Muat ulang.");
  return p;
}

export async function muatDaftar(client: AnyClient, f: FilterKomplain, opsi: { limit?: number; offset?: number } = {}): Promise<HasilDaftar> {
  const p = paramSaringan(f);
  const { data, error } = await client.rpc(FUNGSI_KOMPLAIN.daftar, {
    ...p, p_q: f.q || null, p_urut: f.urut, p_limit: opsi.limit ?? UKURAN_HALAMAN, p_offset: opsi.offset ?? (f.hal - 1) * UKURAN_HALAMAN,
  });
  if (error) throw galat(error, "Daftar komplain belum dapat dimuat. Muat ulang sebentar lagi.");
  const d = bacaDaftar(data);
  if (!d) throw new KomplainError("Daftar komplain belum dapat dibaca lengkap. Muat ulang.");
  return d;
}

export async function muatDetail(client: AnyClient, id: string): Promise<DetailKomplain> {
  if (!adalahUuid(id)) throw new KomplainError("Komplain tidak ditemukan atau bukan untuk akun Anda.");
  const { data, error } = await client.rpc(FUNGSI_KOMPLAIN.lihat, { p_id: id });
  if (error) throw galat(error, "Komplain belum dapat dimuat. Muat ulang sebentar lagi.");
  const d = bacaDetail(data);
  if (!d) throw new KomplainError("Komplain belum dapat dibaca lengkap. Muat ulang.");
  return d;
}

export async function muatDashboard(client: AnyClient, f: FilterKomplain): Promise<Dashboard> {
  const { data, error } = await client.rpc(FUNGSI_KOMPLAIN.dashboard, paramSaringan(f));
  if (error) throw galat(error, "Dashboard komplain belum dapat dimuat. Muat ulang sebentar lagi.");
  const d = bacaDashboard(data);
  if (!d) throw new KomplainError("Dashboard komplain belum dapat dibaca lengkap. Muat ulang.");
  return d;
}

export async function muatKategori(client: AnyClient): Promise<HasilKategori> {
  const { data, error } = await client.rpc(FUNGSI_KOMPLAIN.kategoriDaftar);
  if (error) throw galat(error, "Kategori belum dapat dimuat. Muat ulang sebentar lagi.");
  const d = bacaKategori(data);
  if (!d) throw new KomplainError("Kategori belum dapat dibaca lengkap. Muat ulang.");
  return d;
}

/** Gerbang tampilan sisi server: sesi + akun aktif. Hak sebenarnya ditegakkan database (RPC menolak bila tidak boleh). Admin Online tidak pernah lolos. */
export async function periksaSesiKomplain(client: AnyClient): Promise<{ ok: boolean; role: string | null }> {
  try {
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return { ok: false, role: null };
    const { data: profile, error: pe } = await client.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
    if (pe || !profile?.role || profile.is_active === false || profile.role === "ADMIN_ONLINE") return { ok: false, role: null };
    return { ok: true, role: String(profile.role) };
  } catch { return { ok: false, role: null }; }
}

export type HasilAksi<T = unknown> = ({ ok: true; sudahAda?: boolean } & T) | { ok: false; pesan: string };

/** Panggil RPC tulis; hasil dibungkus, galat diterjemahkan. */
export async function panggilTulis<T extends Record<string, unknown>>(client: AnyClient, fungsi: string, args: Record<string, unknown>): Promise<HasilAksi<{ data: T }>> {
  try {
    const { data, error } = await client.rpc(fungsi, args);
    if (error) return { ok: false, pesan: pesanGalatKomplain(error.message) };
    const d = (data ?? {}) as T & { already_applied?: boolean };
    return { ok: true, sudahAda: d.already_applied === true, data: d };
  } catch { return { ok: false, pesan: pesanGalatKomplain("") }; }
}
