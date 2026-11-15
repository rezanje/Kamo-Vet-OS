// E4 (meeting 12 Nov 2026): penentuan gudang impor di server (halaman & aksi memakai fungsi yang sama).
import type { createClient } from "@/lib/supabase/server";
import { allowedBranchIds } from "@/lib/branch-access";
import { muatGudangOrderOnline, tentukanGudangImpor, type PenentuanGudangImpor } from "@/lib/online-gudang";

type Db = Awaited<ReturnType<typeof createClient>>;

export async function bacaGudangImpor(db: Db, userId: string, diminta?: string | null): Promise<{ data: PenentuanGudangImpor; error: unknown }> {
  const [{ data: rows, error }, diizinkan] = await Promise.all([muatGudangOrderOnline(db), allowedBranchIds(db, userId)]);
  return { data: tentukanGudangImpor(rows, diizinkan, diminta), error };
}
