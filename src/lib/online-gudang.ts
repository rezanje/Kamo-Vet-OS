import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Gudang yang boleh dipakai order online (manual & impor Shopee). Sejak 20261107030000
 * database menerima semua gudang aktif kecuali EXPIRED dan TRANSIT — daftar ini harus sama.
 * Permintaan Aldi 5 Nov 2026: order online boleh langsung dari gudang petshop cabang.
 */
export const TIPE_GUDANG_ORDER_ONLINE = ["ONLINE", "RETAIL", "DC", "VET"] as const;
export type TipeGudangOnline = (typeof TIPE_GUDANG_ORDER_ONLINE)[number];

const LABEL_TIPE: Record<string, string> = { ONLINE: "Online", RETAIL: "Toko/Petshop", DC: "Gudang distribusi", VET: "Klinik" };
export const labelTipeGudang = (tipe: string) => LABEL_TIPE[tipe] ?? tipe;

export type GudangOnline = { id: string; name: string; branch_id: string; branch_name: string; type: string };
type WhRow = { id: string; name: string; branch_id: string; type: string; branches: { name: string } | { name: string }[] | null };

/** Urutan tampil: per cabang (nama), lalu gudang online dulu, lalu toko, distribusi, klinik. */
export function urutkanGudangOnline(rows: GudangOnline[]): GudangOnline[] {
  const rank = (t: string) => { const i = (TIPE_GUDANG_ORDER_ONLINE as readonly string[]).indexOf(t); return i < 0 ? 99 : i; };
  return [...rows].sort((a, b) => a.branch_name.localeCompare(b.branch_name, "id")
    || rank(a.type) - rank(b.type) || a.name.localeCompare(b.name, "id"));
}

/** Kelompokkan per cabang untuk <optgroup>. */
export function kelompokPerCabang(rows: GudangOnline[]): { cabang: string; gudang: GudangOnline[] }[] {
  const out: { cabang: string; gudang: GudangOnline[] }[] = [];
  for (const g of urutkanGudangOnline(rows)) {
    const last = out[out.length - 1];
    if (last && last.cabang === g.branch_name) last.gudang.push(g);
    else out.push({ cabang: g.branch_name, gudang: [g] });
  }
  return out;
}

/** Semua gudang aktif yang boleh dipakai order online dan terlihat oleh pengguna (RLS tetap berlaku). */
export async function muatGudangOrderOnline(db: Db): Promise<{ data: GudangOnline[]; error: unknown }> {
  const { data, error } = await db.from("warehouses").select("id, name, branch_id, type, branches(name)")
    .in("type", [...TIPE_GUDANG_ORDER_ONLINE]).eq("is_active", true).order("name");
  const rows = ((data ?? []) as unknown as WhRow[]).map((w) => {
    const br = Array.isArray(w.branches) ? w.branches[0] : w.branches;
    return { id: w.id, name: w.name, branch_id: w.branch_id, type: String(w.type), branch_name: br?.name ?? "—" };
  });
  return { data: urutkanGudangOnline(rows), error };
}

// ── E4 (meeting 12 Nov 2026): gudang impor otomatis mengikuti cabang akun ─────
//
// Operator sering salah pilih gudang. Sekarang yang dipilih (bila perlu) adalah CABANG,
// gudangnya ditentukan sistem: satu "gudang utama" per cabang —
//   1. gudang Toko/Petshop (RETAIL) bila cabang punya tepat satu;
//   2. selain itu, satu-satunya gudang order-online cabang itu (mis. cabang B2C, klinik);
//   3. cabang dengan beberapa gudang setara (mis. DC) tidak ditebak → tidak ditawarkan.
// Gudang ONLINE terpisah di cabang petshop (WH ONLINE PDRY/TKI) TIDAK dipilih lagi.

export type CabangImpor = { id: string; name: string; gudang: GudangOnline };

export function gudangUtamaPerCabang(rows: readonly GudangOnline[]): CabangImpor[] {
  const perCabang = new Map<string, GudangOnline[]>();
  for (const g of rows) perCabang.set(g.branch_id, [...(perCabang.get(g.branch_id) ?? []), g]);
  const hasil: CabangImpor[] = [];
  for (const [id, daftar] of perCabang) {
    const toko = daftar.filter((g) => g.type === "RETAIL");
    const utama = toko.length === 1 ? toko[0] : toko.length === 0 && daftar.length === 1 ? daftar[0] : null;
    if (utama) hasil.push({ id, name: utama.branch_name, gudang: utama });
  }
  return hasil.sort((a, b) => a.name.localeCompare(b.name, "id") || a.id.localeCompare(b.id));
}

export type PenentuanGudangImpor = {
  /** Cabang yang boleh dipakai akun ini, masing-masing dengan gudang utamanya. */
  cabang: CabangImpor[];
  /** true = akun hanya punya satu cabang → gudang terkunci, tidak bisa dipilih. */
  terkunci: boolean;
  /** Cabang/gudang terpilih (null = operator masih harus memilih cabang). */
  terpilih: CabangImpor | null;
};

/**
 * @param diizinkan  hasil allowedBranchIds (null = semua cabang).
 * @param diminta    cabang yang dikirim form / bawaan (cabang petshop aktif); diabaikan bila tidak sah.
 */
export function tentukanGudangImpor(rows: readonly GudangOnline[], diizinkan: readonly string[] | null, diminta?: string | null): PenentuanGudangImpor {
  const cabang = gudangUtamaPerCabang(rows).filter((c) => diizinkan === null || diizinkan.includes(c.id));
  if (cabang.length === 1) return { cabang, terkunci: true, terpilih: cabang[0] };
  return { cabang, terkunci: false, terpilih: cabang.find((c) => c.id === diminta) ?? null };
}
