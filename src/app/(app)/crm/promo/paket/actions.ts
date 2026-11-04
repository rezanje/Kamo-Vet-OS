"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readCompleteList } from "@/lib/checked-list";
import { hariIniWIB } from "@/lib/tanggal";
import {
  estimasiHasil, paketAkses, paketFormFromRule, parsePaketForm, paketValuesFromForm, pesanGalatPaket, ringkasPaket, rp, validatePaketForm,
  type PaketForm, type PaketItemInfo, type PaketItemRef,
} from "@/lib/promo-paket";
import { loadPaketHpp, type HppRow } from "@/lib/promo-paket-hpp";

// Promo Paket (Syarat → Hasil): SEMUA penulisan lewat RPC save_promo_syarat_hasil / set_promo_syarat_hasil_active
// (Owner/Admin, token versi, audit, izin di bawah HPP khusus Owner, aktivasi ditolak selama saklar rilis mati).
// Tidak ada penulisan tabel langsung dan TIDAK ADA hapus: promo hanya bisa dinonaktifkan.

const BACK = "/crm/promo";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[a-f0-9]{32}$/;
const TIDAK_BERHAK = "Hanya Owner/Admin aktif yang bisa mengatur promo.";

export type PaketSaveResult =
  | { ok: true; id: string; version: string; active: boolean }
  | { ok: false; message: string; stale?: boolean; issues?: { field: string; message: string }[] };

async function gate() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user ? await supabase.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle() : { data: null };
  const akses = paketAkses(me);
  return { supabase, ...akses };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadItemInfo(supabase: any, ids: string[]): Promise<Map<string, PaketItemInfo>> {
  const map = new Map<string, PaketItemInfo>();
  for (let o = 0; o < ids.length; o += 100) {
    const part = ids.slice(o, o + 100);
    const items = await readCompleteList<{ id: string; code: string; name: string; unit: string; is_active: boolean; item_type: string }>((from, to) =>
      supabase.from("items").select("id,code,name,unit,is_active,item_type", { count: "exact" }).in("id", part).order("id").range(from, to), "Barang promo", { maxRows: null });
    const units = await readCompleteList<{ id: string; item_id: string; unit: string }>((from, to) =>
      supabase.from("item_units").select("id,item_id,unit", { count: "exact" }).in("item_id", part).order("id").range(from, to), "Satuan barang promo", { maxRows: null });
    for (const i of items) map.set(i.id, { id: i.id, code: i.code, name: i.name, active: i.is_active === true && i.item_type === "Persediaan", units: [i.unit, ...units.filter((u) => u.item_id === i.id).map((u) => u.unit)] });
  }
  return map;
}

const refsOf = (f: Pick<PaketForm, "syarat" | "hasil">): PaketItemRef[] => [...f.syarat.flatMap((r) => (r.kind === "qty" ? r.items : [])), ...f.hasil.items];

/** Simpan sebagai DRAF (nonaktif). id null = promo baru. Promo aktif tidak bisa disimpan (database menolak): nonaktifkan dulu. */
export async function simpanPromoPaket(input: { id: string | null; version: string | null; form: unknown }): Promise<PaketSaveResult> {
  const { supabase, allowed, isOwner } = await gate();
  if (!allowed) return { ok: false, message: TIDAK_BERHAK };
  const id = input?.id ?? null, version = input?.version ?? null;
  if ((id !== null && !UUID.test(id)) || (version !== null && !TOKEN.test(version)) || (id === null) !== (version === null)) {
    return { ok: false, message: "Data promo tidak lengkap. Muat ulang halaman." };
  }
  const form = parsePaketForm(input?.form);
  if (!form) return { ok: false, message: "Data promo tidak valid. Muat ulang halaman lalu coba lagi." };
  if (form.belowHpp.allowed && !isOwner) return { ok: false, message: "Hanya Owner yang boleh mengizinkan penjualan di bawah HPP." };

  let items: Map<string, PaketItemInfo>;
  try { items = await loadItemInfo(supabase, [...new Set(refsOf(form).map((r) => r.item_id).filter((x) => UUID.test(x)))]); }
  catch { return { ok: false, message: "Daftar barang belum dapat dibaca lengkap. Muat ulang lalu coba lagi; promo belum disimpan." }; }
  const issues = validatePaketForm(form, { today: hariIniWIB(), items, isOwner });
  if (issues.length) return { ok: false, message: issues.map((i) => i.message).join(" "), issues };

  const nameOf = (item: string) => items.get(item)?.name ?? "Barang tidak tersedia";
  const { data, error } = await supabase.rpc("save_promo_syarat_hasil", { p_id: id, p_expected_version: version, p_values: paketValuesFromForm(form, ringkasPaket(form, nameOf)) });
  if (error) return { ok: false, message: pesanGalatPaket(error), ...(error.code === "40001" ? { stale: true as const } : {}) };
  revalidatePath(BACK);
  return resultFrom(data);
}

function resultFrom(data: unknown): PaketSaveResult {
  const s = data as { version?: string; promo?: { id?: string; is_active?: boolean } } | null;
  if (!s?.promo?.id || !s.version) return { ok: false, message: "Respons simpan belum terkonfirmasi. Muat ulang daftar promo untuk memastikan hasilnya." };
  return { ok: true, id: s.promo.id, version: s.version, active: s.promo.is_active === true };
}

/** Taksiran harga/HPP barang hasil (baca saja) untuk panel peringatan Owner. */
export async function taksirHppPaket(refs: unknown, branchIds: unknown): Promise<{ ok: true; rows: HppRow[] } | { ok: false; message: string }> {
  const { supabase, allowed } = await gate();
  if (!allowed) return { ok: false, message: TIDAK_BERHAK };
  const ok = Array.isArray(refs) && refs.length <= 20 && refs.every((r) => r && typeof r.item_id === "string" && UUID.test(r.item_id) && typeof r.unit === "string" && r.unit.length <= 40);
  const branches = Array.isArray(branchIds) && branchIds.every((b) => typeof b === "string" && UUID.test(b)) ? (branchIds as string[]) : null;
  if (!ok || !branches) return { ok: false, message: "Daftar barang hasil tidak valid." };
  try { return { ok: true, rows: await loadPaketHpp(supabase, refs as PaketItemRef[], branches) }; }
  catch { return { ok: false, message: "HPP belum dapat dibaca. Coba lagi." }; }
}

// Pemeriksaan sebelum aktivasi: harga hasil di bawah HPP tanpa izin Owner akan membuat kasir menolak seluruh transaksi
// (lantai HPP P03), jadi ditolak lebih awal dengan pesan yang menyebut angkanya. Taksiran tak terbaca / HPP tak diketahui
// TIDAK memblokir (database dan kasir tetap otoritas).
async function pesanDiBawahHpp(supabase: Awaited<ReturnType<typeof createClient>>, snapshot: unknown): Promise<string | null> {
  const s = snapshot as { promo?: { rule?: unknown; branch_ids?: string[] | null } } | null;
  const rule = paketFormFromRule(s?.promo?.rule);
  if (!rule || rule.belowHpp.allowed) return null;
  let rows: HppRow[];
  try { rows = await loadPaketHpp(supabase, rule.hasil.items, s?.promo?.branch_ids ?? []); } catch { return null; }
  const value = Number(rule.hasil.value), cap = Number(rule.hasil.maxAmount) || null;
  const bad = rows.map((r) => ({ r, e: estimasiHasil({ price: r.price, hpp: r.hpp, discount: { type: rule.hasil.discountType, value, maxAmount: cap } }) })).filter((x) => x.e.belowHpp === true);
  if (!bad.length) return null;
  const worst = bad.reduce((a, b) => (b.e.lossPerUnit > a.e.lossPerUnit ? b : a));
  return `Dengan promo ini harga jual barang hasil (${rp(worst.e.netPerUnit)}) di bawah perkiraan HPP (${rp(worst.e.hpp ?? 0)}), rugi sekitar ${rp(worst.e.lossPerUnit)}/unit. Kasir akan menolak penjualannya. Minta Owner mencentang izin penjualan di bawah HPP di editor, atau naikkan harga hasil / kecilkan potongan.`;
}

async function terapkanStatus(supabase: Awaited<ReturnType<typeof createClient>>, input: { id: string; version: string; active: boolean }, known?: unknown): Promise<PaketSaveResult> {
  if (input.active) {
    const snap = known ?? (await supabase.rpc("read_promo_edit", { p_id: input.id })).data;
    const pesan = await pesanDiBawahHpp(supabase, snap);
    if (pesan) return { ok: false, message: pesan };
  }
  const { data, error } = await supabase.rpc("set_promo_syarat_hasil_active", { p_id: input.id, p_expected_version: input.version, p_active: input.active });
  if (error) return { ok: false, message: pesanGalatPaket(error), ...(error.code === "40001" ? { stale: true as const } : {}) };
  revalidatePath(BACK);
  return resultFrom(data);
}

export async function ubahStatusPromoPaket(input: { id: string; version: string; active: boolean }): Promise<PaketSaveResult> {
  const { supabase, allowed } = await gate();
  if (!allowed) return { ok: false, message: TIDAK_BERHAK };
  if (!UUID.test(String(input?.id)) || !TOKEN.test(String(input?.version)) || typeof input?.active !== "boolean") return { ok: false, message: "Data promo tidak lengkap. Muat ulang halaman." };
  return terapkanStatus(supabase, input);
}

/** Tombol Aktifkan/Nonaktifkan di daftar promo (satu-satunya aksi selain Edit; tidak ada hapus). */
export async function ubahStatusPaketDariDaftar(formData: FormData): Promise<void> {
  const gagal = (pesan: string): never => redirect(`${BACK}?error=${encodeURIComponent(pesan)}`);
  const { supabase, allowed } = await gate();
  if (!allowed) return gagal(TIDAK_BERHAK);
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "1";
  const was = String(formData.get("was") ?? "") === "1";
  if (!UUID.test(id)) return gagal("Promo tidak valid.");
  const { data: snap, error: readError } = await supabase.rpc("read_promo_edit", { p_id: id });
  const s = snap as { version?: string; promo?: { is_active?: boolean } } | null;
  if (readError || !s?.version) return gagal(pesanGalatPaket(readError ?? { message: "Promo tidak ditemukan" }));
  // Daftar bisa basi: kalau status di database sudah bukan yang dilihat pengguna, jangan membalik diam-diam.
  if ((s.promo?.is_active === true) !== was) return gagal("Status promo sudah berubah sejak daftar dimuat. Muat ulang daftar lalu coba lagi.");
  const result = await terapkanStatus(supabase, { id, version: s.version, active }, snap);
  if (!result.ok) return gagal(result.message);
  redirect(`${BACK}?success=${active ? "paket-aktif" : "paket-nonaktif"}`);
}
