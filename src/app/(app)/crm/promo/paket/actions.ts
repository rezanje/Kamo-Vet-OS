"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readCompleteList } from "@/lib/checked-list";
import { hariIniWIB } from "@/lib/tanggal";
import {
  cekUkuranPaket, estimasiHasil, paketAkses, paketFormFromRule, paketFormFromSnapshot, parsePaketForm, paketValuesFromForm, pesanGalatPaket, ringkasPaket, rp, validatePaketForm,
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
  | { ok: true; id: string; version: string; active: boolean; warning?: string }
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
  // Pagar murah DULU (ukuran daftar, id cabang UUID): tidak ada satu pun pembacaan master untuk payload raksasa/palsu.
  const ukuran = cekUkuranPaket(form);
  if (ukuran.length) return { ok: false, message: ukuran.map((i) => i.message).join(" "), issues: ukuran };

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
  const branches = Array.isArray(branchIds) && branchIds.length <= 200 && branchIds.every((b) => typeof b === "string" && UUID.test(b)) ? (branchIds as string[]) : null;
  if (!ok || !branches) return { ok: false, message: "Daftar barang hasil tidak valid." };
  try { return { ok: true, rows: await loadPaketHpp(supabase, refs as PaketItemRef[], branches) }; }
  catch { return { ok: false, message: "HPP belum dapat dibaca. Coba lagi." }; }
}

// Pemeriksaan harga hasil vs HPP saat aktivasi (Andri 5.1: diblokir bila di bawah HPP dan Owner belum mengizinkan), dengan dua tingkat
// karena taksirannya memang perkiraan dan database TIDAK punya aturan ini saat aktivasi (hanya saklar rilis):
//  - BLOKIR  : taksiran memakai biaya lapisan stok nyata gudang RETAIL cabang itu dan harga cabang (source "lapisan"), tanpa izin Owner.
//              Kasir pasti menolak penjualan seperti itu (lantai HPP P03), jadi aktivasi ditolak dengan angkanya.
//  - PERINGATAN: taksiran hanya dari harga beli master (tanpa lapisan stok) = bisa salah (false positive): promo tetap aktif + peringatan.
//  - Taksiran tak terbaca / HPP tak diketahui: tidak ada pesan apa pun (database dan kasir tetap otoritas).
async function periksaDiBawahHpp(supabase: Awaited<ReturnType<typeof createClient>>, snapshot: unknown): Promise<{ block: string | null; warning: string | null }> {
  const none = { block: null, warning: null };
  const s = snapshot as { promo?: { rule?: unknown; branch_ids?: string[] | null } } | null;
  const rule = paketFormFromRule(s?.promo?.rule);
  if (!rule || rule.belowHpp.allowed) return none;
  let rows: HppRow[];
  try { rows = await loadPaketHpp(supabase, rule.hasil.items, s?.promo?.branch_ids ?? []); } catch { return none; }
  const value = Number(rule.hasil.value), cap = Number(rule.hasil.maxAmount) || null;
  const bad = rows.map((r) => ({ r, e: estimasiHasil({ price: r.price, hpp: r.hpp, discount: { type: rule.hasil.discountType, value, maxAmount: cap } }) })).filter((x) => x.e.belowHpp === true);
  if (!bad.length) return none;
  const worstOf = (list: typeof bad) => list.reduce((a, b) => (b.e.lossPerUnit > a.e.lossPerUnit ? b : a));
  const hard = bad.filter((x) => x.r.source === "lapisan");
  const sentence = (w: (typeof bad)[number]) => `Dengan promo ini harga jual barang hasil (${rp(w.e.netPerUnit)}) di bawah perkiraan HPP (${rp(w.e.hpp ?? 0)}), rugi sekitar ${rp(w.e.lossPerUnit)}/unit.`;
  if (hard.length) {
    // Izin di bawah modal hanya bisa disimpan (dan nanti dihormati kasir) setelah saklar 'below_hpp' dirilis; saklar mati / tak terbaca = belum tersedia.
    const izinTersedia = await belowHppDirilis(supabase);
    const saran = izinTersedia
      ? "Minta Owner mencentang izin penjualan di bawah HPP di editor, atau naikkan harga hasil / kecilkan potongan."
      : "Izin di bawah modal belum tersedia (fitur belum dirilis). Naikkan harga/diskon hadiah di atas modal, atau tunggu fitur dirilis.";
    return { warning: null, block: `Aktivasi ditolak: perkiraan di bawah modal; perlu izin Owner. ${sentence(worstOf(hard))} Kasir akan menolak penjualannya. ${saran}` };
  }
  return { block: null, warning: `Peringatan: perkiraan di bawah modal; perlu izin Owner. ${sentence(worstOf(bad))} Taksiran ini hanya dari harga beli (belum ada lapisan stok), jadi promo tetap diaktifkan; jika benar di bawah modal, kasir bisa menolak penjualan barang hadiah ini.` };
}

async function belowHppDirilis(supabase: Awaited<ReturnType<typeof createClient>>): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("promo_release_enabled", { p_flag: "below_hpp" });
    return !error && data === true;
  } catch { return false; }
}

async function terapkanStatus(supabase: Awaited<ReturnType<typeof createClient>>, input: { id: string; version: string; active: boolean }, known?: unknown): Promise<PaketSaveResult> {
  let warning: string | null = null;
  if (input.active) {
    const snap = known ?? (await supabase.rpc("read_promo_edit", { p_id: input.id })).data;
    const check = await periksaDiBawahHpp(supabase, snap);
    if (check.block) return { ok: false, message: check.block };
    warning = check.warning;
  }
  const { data, error } = await supabase.rpc("set_promo_syarat_hasil_active", { p_id: input.id, p_expected_version: input.version, p_active: input.active });
  if (error) return { ok: false, message: pesanGalatPaket(error), ...(error.code === "40001" ? { stale: true as const } : {}) };
  revalidatePath(BACK);
  const result = resultFrom(data);
  return result.ok && warning ? { ...result, warning } : result;
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
  redirect(`${BACK}?success=${active ? (result.warning ? "paket-aktif-peringatan" : "paket-aktif") : "paket-nonaktif"}`);
}


// ── Salin promo (Andri 5.2) ─────────────────────────────────────────────────────────────────────────────────────
// Salinan = promo BARU nonaktif lewat save_promo_syarat_hasil (p_id null): nama "Salinan dari <nama>", syarat/hasil/cabang sama, izin di bawah HPP
// TIDAK disalin, tanggal mulai = hari ini dan tanggal berakhir dikosongkan (tanggal lama bisa sudah lewat). Boleh dari promo aktif.
async function bikinSalinan(supabase: Awaited<ReturnType<typeof createClient>>, id: string): Promise<PaketSaveResult> {
  const { data: snap, error: readError } = await supabase.rpc("read_promo_edit", { p_id: id });
  if (readError) return { ok: false, message: pesanGalatPaket(readError) };
  const source = paketFormFromSnapshot(snap as never);
  if (!source) return { ok: false, message: "Promo ini bukan promo paket, jadi tidak bisa disalin di sini." };
  // Menyalin salinan: jangan menumpuk "Salinan dari Salinan dari …".
  const dasar = source.name.replace(/^(Salinan dari )+/, "") || source.name;
  const form: PaketForm = { ...source, name: `Salinan dari ${dasar}`.trim().slice(0, 120), validFrom: hariIniWIB(), validUntil: "", belowHpp: { allowed: false, reason: "" } };
  const ukuran = cekUkuranPaket(form);
  if (ukuran.length) return { ok: false, message: ukuran.map((i) => i.message).join(" "), issues: ukuran };
  let items: Map<string, PaketItemInfo>;
  try { items = await loadItemInfo(supabase, [...new Set(refsOf(form).map((r) => r.item_id).filter((x) => UUID.test(x)))]); }
  catch { return { ok: false, message: "Daftar barang belum dapat dibaca lengkap. Coba lagi; salinan belum dibuat." }; }
  const issues = validatePaketForm(form, { today: hariIniWIB(), items, isOwner: false });
  if (issues.length) return { ok: false, message: `Salinan belum bisa dibuat: ${issues.map((i) => i.message).join(" ")}`, issues };
  const nameOf = (item: string) => items.get(item)?.name ?? "Barang tidak tersedia";
  const { data, error } = await supabase.rpc("save_promo_syarat_hasil", { p_id: null, p_expected_version: null, p_values: paketValuesFromForm(form, ringkasPaket(form, nameOf)) });
  if (error) return { ok: false, message: pesanGalatPaket(error) };
  revalidatePath(BACK);
  return resultFrom(data);
}

export async function salinPromoPaket(input: { id: string }): Promise<PaketSaveResult> {
  const { supabase, allowed } = await gate();
  if (!allowed) return { ok: false, message: TIDAK_BERHAK };
  if (!UUID.test(String(input?.id))) return { ok: false, message: "Promo tidak valid. Muat ulang halaman." };
  return bikinSalinan(supabase, input.id);
}

/** Tombol 'Salin promo' di daftar promo: buka salinan di editor, atau kembali ke daftar dengan pesan. */
export async function salinPromoPaketDariDaftar(formData: FormData): Promise<void> {
  const gagal = (pesan: string): never => redirect(`${BACK}?error=${encodeURIComponent(pesan)}`);
  const { supabase, allowed } = await gate();
  if (!allowed) return gagal(TIDAK_BERHAK);
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return gagal("Promo tidak valid.");
  const result = await bikinSalinan(supabase, id);
  if (!result.ok) return gagal(result.message);
  redirect(`${BACK}/paket/${result.id}?salinan=1`);
}
