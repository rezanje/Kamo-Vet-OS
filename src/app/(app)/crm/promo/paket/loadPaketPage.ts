// Pemuat data untuk rute editor Promo Paket (server). Hanya BACA. Akses: Owner/Admin aktif; daftar pilihan dibaca lengkap
// (readCompleteList) — bila ada yang gagal dimuat, editor TIDAK dibuka separuh.
import { readCompleteList } from "@/lib/checked-list";
import { paketAkses, type PaketItemInfo } from "@/lib/promo-paket";
import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;
export const PESAN_TIDAK_BERHAK = "Hanya owner/manajer aktif yang bisa mengatur promo.";
export const PESAN_GAGAL_MUAT = "Pilihan barang/cabang belum dapat dimuat lengkap. Muat ulang sebelum mengedit; promo belum diubah.";
export type Manager = { userId: string; role: "OWNER" | "ADMIN" };

export async function getManager(db: Db): Promise<Manager | null> {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data: me } = await db.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  const akses = paketAkses(me);
  return akses.allowed ? { userId: user.id, role: akses.isOwner ? "OWNER" : "ADMIN" } : null;
}

/** Saklar rilis 'syarat_hasil'. Fungsi belum ada / gagal dibaca = dianggap BELUM rilis (editor tetap buka, aktivasi dijelaskan). */
export async function paketReleased(db: Db): Promise<boolean> {
  const { data, error } = await db.rpc("promo_release_enabled", { p_flag: "syarat_hasil" });
  return !error && data === true;
}

/** Saklar rilis 'below_hpp' (izin Owner menjual di bawah modal). Mati / fungsi belum ada / gagal dibaca = izin BELUM tersedia. */
export async function belowHppReleased(db: Db): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("promo_release_enabled", { p_flag: "below_hpp" });
    return !error && data === true;
  } catch { return false; }
}

type ItemRow = { id: string; code: string; name: string; unit: string; is_active: boolean; item_type: string };

export async function loadPaketOptions(db: Db, usedItemIds: string[] = [], usedBranchIds: string[] = []): Promise<{ items: PaketItemInfo[]; branches: { id: string; name: string }[] } | null> {
  try {
    const [active, units, branches] = await Promise.all([
      readCompleteList<ItemRow>((from, to) => db.from("items").select("id,code,name,unit,is_active,item_type", { count: "exact" }).eq("is_active", true).eq("item_type", "Persediaan").order("name").order("id").range(from, to), "Daftar barang promo", { maxRows: null }),
      readCompleteList<{ id: string; item_id: string; unit: string }>((from, to) => db.from("item_units").select("id,item_id,unit", { count: "exact" }).order("id").range(from, to), "Daftar satuan barang", { maxRows: null }),
      readCompleteList<{ id: string; name: string }>((from, to) => db.from("branches").select("id,code,name", { count: "exact" }).eq("is_active", true).order("name").order("id").range(from, to), "Daftar cabang promo", { maxRows: null }),
    ]);
    const unitsOf = (id: string, base: string) => [base, ...units.filter((u) => u.item_id === id && u.unit !== base).map((u) => u.unit)];
    const items: PaketItemInfo[] = active.map((i) => ({ id: i.id, code: i.code, name: i.name, units: unitsOf(i.id, i.unit), active: true }));
    const have = new Set(items.map((i) => i.id));
    const missing = [...new Set(usedItemIds)].filter((id) => !have.has(id));
    for (let o = 0; o < missing.length; o += 100) {
      const part = missing.slice(o, o + 100);
      const old = await readCompleteList<ItemRow>((from, to) => db.from("items").select("id,code,name,unit,is_active,item_type", { count: "exact" }).in("id", part).order("id").range(from, to), "Barang promo lama", { maxRows: null });
      for (const i of old) items.push({ id: i.id, code: i.code, name: `${i.name} (${i.is_active ? "bukan persediaan" : "nonaktif"})`, units: unitsOf(i.id, i.unit), active: false });
      for (const id of part) if (!old.some((i) => i.id === id)) items.push({ id, code: "—", name: "Barang tidak tersedia", units: [], active: false });
    }
    const branchRows = [...branches];
    const missingBranches = [...new Set(usedBranchIds)].filter((id) => !branchRows.some((b) => b.id === id));
    if (missingBranches.length) {
      const old = await readCompleteList<{ id: string; name: string }>((from, to) => db.from("branches").select("id,code,name", { count: "exact" }).in("id", missingBranches).order("id").range(from, to), "Cabang promo lama", { maxRows: null });
      for (const id of missingBranches) branchRows.push({ id, name: `${old.find((b) => b.id === id)?.name ?? "Cabang tidak tersedia"} (nonaktif)` });
    }
    return { items, branches: branchRows.map((b) => ({ id: b.id, name: b.name })) };
  } catch { return null; }
}
