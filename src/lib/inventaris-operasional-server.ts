import { allowedBranchIds, canUseBranch } from "@/lib/branch-access";
import { createClient, createClientLintasCabang } from "@/lib/supabase/server";
import { pilihCabang, type InvopBranch, type InvopItem } from "@/lib/inventaris-operasional";

/**
 * Konteks halaman Inventaris Operasional: pengguna, cabang yang boleh dibuka (pola KAMO: penempatan cabang,
 * atau semua cabang untuk peran bebas cabang; dibatasi lagi oleh pilihan cabang operasional sesi), dan cabang terpilih.
 * Ini hanya untuk tampilan; database menegakkan ulang akses di RLS dan fungsi tulis.
 */
export async function loadInvopContext(requested: string | undefined) {
  const supabase = await createClient();
  const { cabangAktif } = await createClientLintasCabang();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, branches: [] as InvopBranch[], branch: null };
  const allowed = await allowedBranchIds(supabase, user.id);
  const { data, error } = await supabase.from("branches").select("id,name").eq("is_active", true).order("name");
  if (error) throw new Error("Daftar cabang gagal dimuat");
  const branches = ((data ?? []) as InvopBranch[]).filter(b => canUseBranch(allowed, b.id) && (!cabangAktif || b.id === cabangAktif));
  return { supabase, user, branches, branch: pilihCabang(branches, requested, cabangAktif) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadInvopItems(supabase: any, branchId: string): Promise<InvopItem[]> {
  const { data, error } = await supabase.from("operational_inventory_items")
    .select("id,nama,satuan,qty,revision,updated_at")
    .eq("branch_id", branchId).eq("is_active", true).order("nama").order("id").limit(1001);
  if (error) throw new Error("Daftar inventaris operasional gagal dimuat");
  const rows = (data ?? []) as InvopItem[];
  if (rows.length > 1000) throw new Error("Barang inventaris operasional cabang ini melebihi 1000; hubungi admin");
  return rows.map(r => ({ ...r, qty: Number(r.qty), revision: Number(r.revision) }));
}
