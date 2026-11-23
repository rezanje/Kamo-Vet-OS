// Inventaris Operasional (23 Nov 2026): perlengkapan cabang (sapu, ember, alat pel). Kuantitas saja —
// tanpa nilai rupiah, jurnal, penyusutan, atau stok barang jual. Fungsi murni di sini dites di
// __tests__/inventaris-operasional.test.ts; penegakan akses dan atomisitas ada di database
// (migrasi 20261206100000_inventaris_operasional.sql).

export const INVOP_PATH = "/pos/inventaris-operasional";
export const INVOP_SUBMENU_ID = "pos.inventaris-operasional";

export type InvopItem = { id: string; nama: string; satuan: string; qty: number; revision: number; updated_at: string };
export type InvopBranch = { id: string; name: string };
export type OpnameLine = { item_id: string; revision: number; qty_fisik: number; alasan: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Jumlah >= 0, maks. 2 desimal; koma Indonesia diterima. null = tidak valid / kosong. */
export function parseQty(raw: unknown): number | null {
  const text = String(raw ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const selisih = (tercatat: number, fisik: number) => Math.round((fisik - tercatat) * 100) / 100;

export function fmtQty(n: number): string {
  return n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

export function fmtSelisih(n: number): string {
  return n > 0 ? `+${fmtQty(n)}` : fmtQty(n);
}

/**
 * Cabang yang dipakai halaman. Bila sesi sedang memilih satu cabang operasional, hanya cabang itu.
 * Selain itu pilihan `?cabang=` bila diizinkan, lalu cabang pertama. null = tidak ada cabang yang boleh dibuka.
 */
export function pilihCabang(allowed: InvopBranch[], requested: string | undefined, cabangAktif: string | null): InvopBranch | null {
  if (cabangAktif) return allowed.find(b => b.id === cabangAktif) ?? null;
  return allowed.find(b => b.id === requested) ?? allowed[0] ?? null;
}

export type OpnameParse = { ok: true; lines: OpnameLine[] } | { ok: false; error: string };

/**
 * Baca formulir opname: tiap barang mengirim item_id, revision, fisik_<id>, alasan_<id>.
 * Isi kiriman hanya bergantung pada formulir (bukan pada saldo terbaru), supaya kiriman ulang yang sama tetap identik
 * dan database mengembalikan opname pertama. Kewajiban alasan untuk selisih ditegakkan database (dan formulir).
 * `nama` hanya untuk pesan.
 */
export function parseOpnameForm(form: FormData, nama: Map<string, string> = new Map()): OpnameParse {
  const ids = form.getAll("item_id").map(String);
  const revs = form.getAll("revision").map(String);
  if (ids.length === 0 || ids.length !== revs.length) return { ok: false, error: "Belum ada barang yang dihitung." };
  const seen = new Set<string>();
  const lines: OpnameLine[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const rev = Number(revs[i]);
    if (!isUuid(id) || seen.has(id) || !Number.isInteger(rev) || rev < 1) return { ok: false, error: "Formulir opname tidak lengkap. Muat ulang halaman." };
    seen.add(id);
    const label = nama.get(id) ?? "barang";
    const fisik = parseQty(form.get(`fisik_${id}`));
    if (fisik === null) return { ok: false, error: `Jumlah fisik "${label}" wajib diisi (angka 0 atau lebih).` };
    const alasan = String(form.get(`alasan_${id}`) ?? "").trim();
    if (alasan.length > 500) return { ok: false, error: `Alasan "${label}" maksimal 500 huruf.` };
    lines.push({ item_id: id, revision: rev, qty_fisik: fisik, alasan: alasan || null });
  }
  return { ok: true, lines };
}

/** Pesan database -> kalimat untuk petugas (tanpa kode teknis). */
export function pesanGagal(message: string | undefined | null): string {
  const m = String(message ?? "");
  if (m.includes("INVENTARIS_SALDO_BERUBAH") || m.includes("INVENTARIS_DAFTAR_BERUBAH")) {
    return "Jumlah atau daftar barang sudah diubah orang lain sejak halaman dibuka. Hitungan belum disimpan; muat ulang lalu isi lagi.";
  }
  if (m.includes("INVENTARIS_MENU_DITOLAK")) return "Akun ini belum diberi akses menu Inventaris Operasional. Minta Owner mengaturnya di Akses Grup.";
  if (m.includes("INVENTARIS_CABANG_DITOLAK") || m.includes("ADMIN_ONLINE") || m.includes("permission denied")) {
    return "Anda tidak punya akses ke cabang ini.";
  }
  const known = [/Alasan selisih "[^"]+" wajib diisi[^.]*/, /Barang "[^"]+" \([^)]*\) sudah ada di cabang ini/, /Jumlah (awal|fisik)[^.]*/, /Nama barang wajib[^.]*/,
    /Satuan wajib[^.]*/, /Akun tidak aktif/, /Cabang tidak aktif/, /Kunci permintaan sudah dipakai[^.]*/];
  for (const re of known) { const hit = m.match(re); if (hit) return hit[0]; }
  return "Gagal menyimpan. Coba lagi; bila berulang, hubungi admin.";
}
