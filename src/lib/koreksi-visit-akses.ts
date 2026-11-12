/**
 * A5 (meeting 12 Nov 2026): izin Akses Grup "Koreksi visit rawat inap" (`klinik.koreksi_visit`, izin khusus).
 *
 * Pemegang izin (dan Owner) boleh: mencatat visit dokter lebih dari 48 jam lalu; mengubah waktu/tanggal/dokter/jenis/paramedis
 * visit; menambah/mengubah catatan setelah pasien pulang/RIP (tanpa obat/tagihan). Semuanya wajib alasan.
 *
 * Ini BUKAN otorisasi: pagar database (migrasi 20261116300000_a5_koreksi_visit_rawat_inap.sql) memeriksa ulang setiap simpan.
 * Pola sama dengan "Batalkan penerimaan" (batal-penerimaan-akses.ts): Owner tidak pernah terkunci oleh galat baca; peran lain
 * gagal-tertutup.
 */
export const IZIN_KOREKSI_VISIT = "klinik.koreksi_visit";

/** Batas visit dokter "tepat waktu" (aturan H06 di database). Lebih lama dari ini = koreksi. */
export const BATAS_VISIT_JAM = 48;

/** Pembacaan murni: true/false dari database, null = gagal baca. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function bacaBolehKoreksiVisit(supabase: any): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.rpc("clinic_inpatient_visit_correction_allowed");
    if (!error) return data === true;
  } catch { /* gagal baca = tidak diketahui */ }
  return null;
}

/** Keputusan untuk layar/aksi: jawaban database; bila tak terbaca, Owner tetap boleh (database memutuskan), peran lain tidak. */
export function putuskanBolehKoreksiVisit(dibaca: boolean | null, role: string | null | undefined): boolean {
  return dibaca === null ? role === "OWNER" : dibaca;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function bolehKoreksiVisit(supabase: any, role: string | null | undefined): Promise<boolean> {
  return putuskanBolehKoreksiVisit(await bacaBolehKoreksiVisit(supabase), role);
}

/** Visit dokter yang waktunya lebih dari 48 jam sebelum `sekarang` adalah koreksi (wajib izin + alasan). */
export function visitTerlambat(logKind: unknown, waktu: Date | null, sekarang: Date = new Date()): boolean {
  return logKind === "doctor_visit" && !!waktu && !Number.isNaN(waktu.getTime())
    && waktu.getTime() < sekarang.getTime() - BATAS_VISIT_JAM * 3600_000;
}

/** Alasan koreksi yang sah (sama dengan database: 3–500 huruf setelah dirapikan); selain itu null. */
export function alasanKoreksi(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length >= 3 && text.length <= 500 ? text : null;
}

type VisitFields = { log_kind?: string | null; visit_doctor_id?: string | null; paramedic_id?: string | null };

/**
 * Apakah perubahan catatan menyentuh bagian visit dokter yang dijaga (waktu, tanggal, dokter, jenis, paramedis).
 * `waktuBerubah` = jam/tanggal yang dikirim berbeda dari yang tersimpan. Hanya berlaku bila catatan lama ATAU baru adalah visit dokter.
 */
export function ubahBagianVisit(before: VisitFields, after: VisitFields, waktuBerubah: boolean): boolean {
  if (before.log_kind !== "doctor_visit" && after.log_kind !== "doctor_visit") return false;
  const beda = (k: keyof VisitFields) => k in after && (after[k] ?? null) !== (before[k] ?? null);
  return waktuBerubah || beda("log_kind") || beda("visit_doctor_id") || beda("paramedic_id");
}
