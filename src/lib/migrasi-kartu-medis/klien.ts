/**
 * Antarmuka klien user TERAUTENTIKASI yang di-inject (K4). Modul migrasi tidak membuat klien, tidak membaca kredensial,
 * dan tidak memakai service-role. Klien wajib mengirim konteks cabang persis seperti aplikasi (K6): mode `cabang`
 * selalu dengan header `x-kamo-operational-branch`, mode `semua-cabang` tanpa header (hanya untuk OWNER terbukti).
 */
export type KonteksJaringan = { mode: "cabang"; cabangId: string } | { mode: "semua-cabang" };

export type JawabanKlien = { data: unknown; error: { message: string; code?: string } | null };

export type NamaRpcMigrasi =
  | "import_legacy_identity_scan"
  | "import_legacy_medical_records_bulk"
  | "detail_riwayat_bersama"
  | "riwayat_bersama_hewan"
  | "hasil_impor_rekam_medis";

export interface KlienMigrasi {
  readonly konteks: KonteksJaringan;
  idPengguna(): Promise<string | null>;
  rpc(nama: NamaRpcMigrasi, args: Record<string, unknown>): Promise<JawabanKlien>;
  /** SELECT biasa (RLS pemanggil) dengan filter `id in (...)`. */
  pilih(tabel: "profiles" | "customers" | "pets", kolom: string, nilaiId: string[]): Promise<JawabanKlien>;
  /**
   * INSERT satu kartu pelanggan lewat RLS pemanggil, sama dengan impor pelanggan di aplikasi (Pengaturan > Impor):
   * `imported_at` terisi sejak lahir sehingga kartu riwayat lama tidak pernah dihitung "pelanggan baru" (Q01).
   * Jawaban: `{ id }` (atau larik satu baris) kartu yang dibuat.
   */
  buatPemilik(kartu: KartuPemilikBaru): Promise<JawabanKlien>;
}

export type KartuPemilikBaru = { name: string; phone: string; address: string | null; imported_at: string };

export class GagalTertutup extends Error {}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** OWNER aktif + konteks eksplisit yang sah; selain itu berhenti sebelum panggilan data apa pun (K5/K6). */
export async function pastikanPemanggil(klien: KlienMigrasi): Promise<string> {
  const k = klien.konteks;
  if (!k || (k.mode !== "cabang" && k.mode !== "semua-cabang")) throw new GagalTertutup("Konteks jaringan wajib eksplisit.");
  if (k.mode === "cabang" && !UUID_RE.test(k.cabangId)) throw new GagalTertutup("Konteks cabang wajib UUID.");
  const userId = await klien.idPengguna();
  if (!userId || !UUID_RE.test(userId)) throw new GagalTertutup("Pemanggil belum terautentikasi.");
  const { data, error } = await klien.pilih("profiles", "id,role,is_active", [userId]);
  if (error || !Array.isArray(data) || data.length !== 1) throw new GagalTertutup("Profil pemanggil tidak terbaca.");
  const profil = data[0] as { id?: unknown; role?: unknown; is_active?: unknown };
  if (profil.id !== userId || profil.role !== "OWNER" || profil.is_active !== true) {
    throw new GagalTertutup("Mode end-to-end hanya untuk OWNER aktif.");
  }
  return userId;
}
