// E4 (meeting 12 Nov 2026): penentuan gudang impor di server (halaman & aksi memakai fungsi yang sama).
import type { createClient } from "@/lib/supabase/server";
import { allowedBranchIds } from "@/lib/branch-access";
import { muatGudangOrderOnline, tentukanGudangImpor, type PenentuanGudangImpor } from "@/lib/online-gudang";
import { isAdminOnline } from "@/lib/admin-online";
import { bacaGudangAdminOnline } from "@/lib/admin-online-impor";

type Db = Awaited<ReturnType<typeof createClient>>;

/** `role` = peran akun; Admin Online membaca lewat RPC khusus (tabel tertutup untuknya), peran lain: jalur lama persis. */
export async function bacaGudangImpor(db: Db, userId: string, diminta?: string | null, role?: string | null): Promise<{ data: PenentuanGudangImpor; error: unknown }> {
  const baca = isAdminOnline(role) ? bacaGudangAdminOnline(db) : muatGudangOrderOnline(db);
  const [{ data: rows, error }, diizinkan] = await Promise.all([baca, allowedBranchIds(db, userId)]);
  return { data: tentukanGudangImpor(rows, diizinkan, diminta), error };
}
