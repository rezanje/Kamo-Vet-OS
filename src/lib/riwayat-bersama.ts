/**
 * RS-2: riwayat bersama hasil impor (kunjungan tanpa cabang) di jalur pelanggan → hewan → riwayat → detail.
 *
 * SELECT biasa menyembunyikan riwayat ini saat cabang aktif dipilih (RLS cabang). OWNER aktif membacanya lewat
 * dua RPC baca-saja yang dibatasi database: `riwayat_bersama_hewan` (1–200 baris per halaman) dan
 * `detail_riwayat_bersama`. Keduanya hanya mengembalikan kunjungan tanpa cabang berjejak impor yang pelanggannya
 * memang pemilik hewan. Halaman memakai hasil yang sama di cabang aktif maupun "Semua cabang".
 *
 * Gagal dimuat ≠ kosong: galat apa pun (termasuk ditolak) menjadi pesan generik, tidak pernah daftar kosong.
 */
import { ListLoadError } from "./checked-list";

// Supabase clients and the lightweight test clients share this surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export const HALAMAN_RIWAYAT_BERSAMA = 200;
export const MAKS_RIWAYAT_BERSAMA = 1000;
export const PESAN_GAGAL_RIWAYAT_BERSAMA = "Riwayat lama hewan ini belum dapat dimuat lengkap. Coba muat ulang.";
export const PESAN_RIWAYAT_BERSAMA_TERLALU_BANYAK =
  `Riwayat lama hewan ini melebihi ${MAKS_RIWAYAT_BERSAMA.toLocaleString("id-ID")} baris dan belum dapat ditampilkan lengkap.`;

export type RiwayatBersama = {
  visit_id: string;
  pet_id: string;
  customer_id: string;
  tanggal: string;
  dokter: string | null;
  keluhan: string | null;
  diagnosis: string | null;
  anamnesis: string | null;
  gejala_klinis: string | null;
  /** Dari `medical_records.catatan_resep` (kolom terapi hasil impor). */
  terapi: string | null;
};

const teks = (value: unknown): string | null => (value == null ? null : typeof value === "string" ? value : null);

/** Satu baris jawaban RPC; `null` bila bentuknya tidak sah (pemanggil menganggapnya gagal, bukan kosong). */
function baris(item: unknown): RiwayatBersama | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  if (typeof row.visit_id !== "string" || !row.visit_id || typeof row.pet_id !== "string" || typeof row.customer_id !== "string"
    || typeof row.tanggal !== "string" || Number.isNaN(Date.parse(row.tanggal))) return null;
  for (const key of ["dokter", "keluhan", "diagnosis", "anamnesis", "gejala_klinis", "terapi"]) {
    if (row[key] != null && typeof row[key] !== "string") return null;
  }
  return {
    visit_id: row.visit_id, pet_id: row.pet_id, customer_id: row.customer_id, tanggal: row.tanggal,
    dokter: teks(row.dokter), keluhan: teks(row.keluhan), diagnosis: teks(row.diagnosis), anamnesis: teks(row.anamnesis),
    gejala_klinis: teks(row.gejala_klinis), terapi: teks(row.terapi),
  };
}

/** OWNER aktif (profil sendiri). Melempar bila profil tidak terbaca: tidak tahu ≠ bukan OWNER. */
export async function ownerAktif(client: Client, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await client.from("profiles").select("role, is_active").eq("id", userId).maybeSingle();
  if (error) throw new ListLoadError(PESAN_GAGAL_RIWAYAT_BERSAMA);
  return data?.role === "OWNER" && data?.is_active === true;
}

/**
 * DOKTER aktif (profil sendiri). Sejak migrasi 20261109100100 DOKTER aktif membaca riwayat impor tanpa cabang lewat
 * SELECT biasa (RLS, baca saja); halaman detail menampilkannya dengan tampilan baca-saja, bukan halaman kerja.
 * Melempar bila profil tidak terbaca: tidak tahu ≠ bukan dokter.
 */
export async function dokterAktif(client: Client, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await client.from("profiles").select("role, is_active").eq("id", userId).maybeSingle();
  if (error) throw new ListLoadError(PESAN_GAGAL_RIWAYAT_BERSAMA);
  return data?.role === "DOCTOR" && data?.is_active === true;
}

/**
 * Semua riwayat bersama satu hewan, terbaru dulu. Halaman 200 baris sampai habis, maksimal 1.000 baris.
 * Baris ke-1.001 dicek eksplisit: bila ada, gagal "terlalu banyak" (tidak pernah dipotong diam-diam).
 * Setiap baris wajib milik hewan & pelanggan yang diharapkan, tanpa ID ganda; selain itu gagal.
 */
export async function bacaRiwayatBersamaHewan(client: Client, petId: string, customerId: string): Promise<RiwayatBersama[]> {
  const rows: RiwayatBersama[] = [];
  const ids = new Set<string>();
  const halaman = async (dari: number, jumlah: number) => {
    let result: { data: unknown; error: unknown };
    try { result = await client.rpc("riwayat_bersama_hewan", { p_pet: petId, p_dari: dari, p_jumlah: jumlah }); }
    catch { throw new ListLoadError(PESAN_GAGAL_RIWAYAT_BERSAMA); }
    if (result.error || !Array.isArray(result.data) || result.data.length > jumlah) throw new ListLoadError(PESAN_GAGAL_RIWAYAT_BERSAMA);
    return result.data.map((item) => {
      const row = baris(item);
      if (!row || row.pet_id !== petId || row.customer_id !== customerId) throw new ListLoadError(PESAN_GAGAL_RIWAYAT_BERSAMA);
      return row;
    });
  };
  for (let dari = 0; dari < MAKS_RIWAYAT_BERSAMA; dari += HALAMAN_RIWAYAT_BERSAMA) {
    const page = await halaman(dari, HALAMAN_RIWAYAT_BERSAMA);
    for (const row of page) {
      if (ids.has(row.visit_id)) throw new ListLoadError(PESAN_GAGAL_RIWAYAT_BERSAMA);
      ids.add(row.visit_id);
      rows.push(row);
    }
    if (page.length < HALAMAN_RIWAYAT_BERSAMA) return rows;
  }
  if ((await halaman(MAKS_RIWAYAT_BERSAMA, 1)).length) throw new ListLoadError(PESAN_RIWAYAT_BERSAMA_TERLALU_BANYAK);
  return rows;
}

export type DetailRiwayatBersama =
  | { status: "ada"; row: RiwayatBersama }
  | { status: "tidak-ada" }
  | { status: "gagal" };

/** Satu riwayat bersama. "tidak-ada" hanya bila database menjawab kosong; galat/bentuk aneh = "gagal". */
export async function bacaDetailRiwayatBersama(client: Client, visitId: string): Promise<DetailRiwayatBersama> {
  let result: { data: unknown; error: unknown };
  try { result = await client.rpc("detail_riwayat_bersama", { p_visit: visitId }); }
  catch { return { status: "gagal" }; }
  if (result.error || !Array.isArray(result.data) || result.data.length > 1) return { status: "gagal" };
  if (!result.data.length) return { status: "tidak-ada" };
  const row = baris(result.data[0]);
  return row && row.visit_id === visitId ? { status: "ada", row } : { status: "gagal" };
}

type RelasiNama = { name: string | null; species?: string | null; breed?: string | null; phone?: string | null };
const satu = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export type RiwayatImporLintasCabang =
  | { status: "ada"; row: RiwayatBersama; pet: RelasiNama | null; owner: RelasiNama | null }
  | { status: "tidak-ada" }
  | { status: "gagal" };

/**
 * Satu riwayat impor tanpa cabang lewat SELECT biasa (RLS pemanggil), untuk tampilan baca-saja. Dipakai (1) dengan
 * klien TANPA header cabang saat cabang aktif dipilih dan bacaan berheader tidak menemukan kunjungan: pengguna yang
 * memang melihat riwayat impor di "Semua cabang" (ADMIN/FINANCE lintas cabang) mendapat tampilan baca-saja; (2) dengan
 * klien biasa untuk DOKTER aktif (RLS 20261109100100). Pengguna lain tetap tidak melihatnya (RLS) = "tidak-ada".
 * Galat/bentuk aneh = "gagal".
 */
export async function bacaRiwayatImporLintasCabang(client: Client, visitId: string): Promise<RiwayatImporLintasCabang> {
  let kunjungan: { data: unknown; error: unknown };
  let rekam: { data: unknown; error: unknown };
  try {
    [kunjungan, rekam] = await Promise.all([
      client.from("visits").select("id, pet_id, customer_id, branch_id, legacy_source_key, created_at, dokter, keluhan, pets(name, species, breed), customers(name, phone)")
        .eq("id", visitId).maybeSingle(),
      client.from("medical_records").select("id, diagnosis, anamnesis, gejala_klinis, catatan_resep")
        .eq("visit_id", visitId).order("id").limit(1).maybeSingle(),
    ]);
  } catch { return { status: "gagal" }; }
  if (kunjungan.error || rekam.error) return { status: "gagal" };
  const v = kunjungan.data as Record<string, unknown> | null;
  if (!v) return { status: "tidak-ada" };
  if (v.id !== visitId || typeof v.pet_id !== "string" || typeof v.customer_id !== "string" || typeof v.created_at !== "string") return { status: "gagal" };
  if (!adalahRiwayatBersama(v as { branch_id?: string | null; legacy_source_key?: string | null })) return { status: "tidak-ada" };
  const m = (rekam.data ?? {}) as Record<string, unknown>;
  const row = baris({
    visit_id: v.id, pet_id: v.pet_id, customer_id: v.customer_id, tanggal: v.created_at, dokter: v.dokter ?? null, keluhan: v.keluhan ?? null,
    diagnosis: m.diagnosis ?? null, anamnesis: m.anamnesis ?? null, gejala_klinis: m.gejala_klinis ?? null, terapi: m.catatan_resep ?? null,
  });
  if (!row) return { status: "gagal" };
  return { status: "ada", row, pet: satu(v.pets as RelasiNama | RelasiNama[] | null), owner: satu(v.customers as RelasiNama | RelasiNama[] | null) };
}

/** Riwayat bersama = tanpa cabang + berjejak impor (sama dengan syarat pembaca di database). */
export const adalahRiwayatBersama = (visit: { branch_id?: string | null; legacy_source_key?: string | null }) =>
  visit.branch_id == null && Boolean(visit.legacy_source_key);
