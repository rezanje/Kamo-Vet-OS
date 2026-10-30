/**
 * Kontrak master kartu medis ternormalisasi (docs/rencana-migrasi-kartu-medis.md §9 K1/K2).
 *
 * Master tanpa penanda versi hanya diterima sebagai `legacy-master-v0` bila SEMUA tanda tangan header di bawah
 * dikenali persis. Penanda eksplisit `contract_version` boleh dipakai; nilai yang tidak dikenal = gagal.
 * Kolom dicari menurut label (tidak bergantung urutan/huruf kolom); baris 5/29/35 hanya petunjuk.
 */

export const VERSI_LEGACY_MASTER_V0 = "legacy-master-v0";
export const VERSI_DIKENAL: readonly string[] = [VERSI_LEGACY_MASTER_V0];
export const LABEL_PENANDA_VERSI = "contract_version";

export type NamaBlok = "pemilik" | "hewan" | "riwayat" | "mapping_file" | "mapping_sheet";

type TandaTangan<F extends string> = { sheet: string; label: Record<F, string> };

const PEMILIK = {
  sheet: "Pemilik",
  label: {
    local_owner_id: "local_owner_id (staging)",
    name: "Nama pemilik | name",
    phone: "Nomor telepon | phone",
    address: "Alamat | address",
    customer_uuid: "customers.id (UUID aktual)",
    review_status: "Status review (staging)",
    decision: "Keputusan reviewer (staging)",
  },
} as const satisfies TandaTangan<string>;

const HEWAN = {
  sheet: "Hewan",
  label: {
    local_pet_id: "local_pet_id (staging)",
    local_owner_id: "local_owner_id (staging)",
    name: "Nama hewan | name",
    species: "Jenis | species",
    breed: "Ras | breed",
    gender: "Kelamin | gender",
    dob: "Tanggal lahir | dob",
    dob_raw: "DOB mentah (staging)",
    pet_uuid: "pets.id (UUID aktual)",
    review_status: "Status review (staging)",
    decision: "Keputusan reviewer (staging)",
  },
} as const satisfies TandaTangan<string>;

const RIWAYAT = {
  sheet: "RiwayatMedis",
  label: {
    local_record_id: "local_record_id (staging)",
    local_pet_id: "local_pet_id (staging)",
    record_date: "Tanggal usulan | record_date",
    record_no: "No. rekam | record_no",
    doctor: "Dokter | doctor",
    note: "Catatan / keluhan | note",
    anamnesis: "Anamnesis | anamnesis",
    clinical_findings: "Gejala klinis | clinical_findings",
    diagnosis: "Diagnosis | diagnosis",
    therapy: "Terapi | therapy",
    review_status: "Status review (staging)",
    source_sheet: "Sheet sumber (staging)",
    decision: "Keputusan reviewer (staging)",
  },
} as const satisfies TandaTangan<string>;

const MAPPING_FILE = {
  sheet: "Mapping",
  label: {
    sample_id: "sample_id",
    file: "File asli",
    path_components: "Path components asli (JSON)",
    sha256: "SHA-256 file",
    drive_url: "Drive file URL",
    sheet_count: "Jumlah sheet",
    photos_excluded: "Foto medis dikecualikan",
    original_changes: "Perubahan asli",
  },
} as const satisfies TandaTangan<string>;

const MAPPING_SHEET = {
  sheet: "Mapping",
  label: {
    local_ref: "ID lokal / sumber",
    file: "File",
    sheet: "Sheet asli",
    source_key: "source_key asli",
    tab_date: "Tanggal tab",
    cell_date: "Tanggal sel",
    change_note: "Catatan perubahan staging",
    dedupe_note: "Relasi dedupe",
  },
} as const satisfies TandaTangan<string>;

export const TANDA_TANGAN = {
  pemilik: PEMILIK,
  hewan: HEWAN,
  riwayat: RIWAYAT,
  mapping_file: MAPPING_FILE,
  mapping_sheet: MAPPING_SHEET,
} as const;

export type FieldBlok<B extends NamaBlok> = keyof (typeof TANDA_TANGAN)[B]["label"];

export const SHEET_WAJIB: readonly string[] = ["Pemilik", "Hewan", "RiwayatMedis", "Mapping"];

/** Label dinormalisasi: huruf kecil, spasi tepi dibuang, spasi beruntun dirapatkan. Tidak ada alias. */
export function normalLabel(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

export const BATAS_SUMBER = {
  /** Ukuran berkas .xlsx. */
  bytesBerkas: 20 * 1024 * 1024,
  /** Total isi zip setelah dekompresi (dari direktori pusat zip). */
  bytesTakTerkompresi: 200 * 1024 * 1024,
  entriZip: 2_000,
  /** Baris yang dipindai untuk mencari header/penanda. */
  barisPindaiHeader: 60,
  barisDataPerSheet: 20_000,
  kolom: 64,
} as const;

/** Literal keputusan yang membuat baris LAYAK DITINJAU untuk apply (bukan otorisasi produksi). K3. */
export const KEPUTUSAN_SETUJU = "SETUJU";
