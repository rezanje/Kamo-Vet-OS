/**
 * Penanda baris rekam medis yang ditambahkan SETELAH pemeriksaan disimpan
 * (keputusan Andri 29 Okt, opsi B: semua item klinik harus masuk rekam medis).
 *
 * Sumbernya dua: dokter lewat layar Detail rekam medis, dan kasir lewat layar
 * Pembayaran. Nama pelaku disimpan sebagai snapshot di baris resepnya, jadi
 * label ini tidak pernah merekonstruksi nama dari data karyawan hari ini.
 */
export type SusulanFields = {
  susulan_at?: string | null;
  susulan_by_name?: string | null;
  susulan_source?: string | null;
};

/**
 * Compatibility is only for the requested public wrapper being absent from the
 * PostgREST schema cache. SQLSTATE 42883 can instead mean a missing INTERNAL
 * dependency in an existing wrapper; falling back then would omit the record.
 * An unrecognized message fails closed rather than guessing at availability.
 */
export function isMissingRecordWrapper(
  error: { code?: string; message?: string } | null | undefined,
  wrapper: "clinic_post_invoice_with_record" | "clinic_post_dp_and_admit_with_record" | "clinic_edit_invoice_with_record",
  params: Record<string, unknown>,
): boolean {
  if (error?.code !== "PGRST202") return false;
  // Supabase serializes args as JSON: undefined-valued keys are omitted.
  const signature = Object.keys(params).filter((key) => params[key] !== undefined).sort().join(", ");
  return error.message === `Could not find the function public.${wrapper}(${signature}) in the schema cache`;
}

const SUMBER: Record<string, string> = { dokter: "dokter", kasir: "kasir" };

const jam = (iso: string) => new Date(iso).toLocaleString("id-ID", {
  timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

/** "Ditambahkan setelah pemeriksaan oleh Drh. Andri (dokter), 01 Nov 2026 14.30" */
export function labelSusulan(row: SusulanFields | null | undefined): string | null {
  if (!row?.susulan_at) return null;
  const waktu = new Date(row.susulan_at);
  if (Number.isNaN(waktu.getTime())) return null;
  const sumber = SUMBER[String(row.susulan_source ?? "")];
  const oleh = row.susulan_by_name?.trim() || "petugas yang tidak tercatat";
  return `Ditambahkan setelah pemeriksaan oleh ${oleh}${sumber ? ` (${sumber})` : ""}, ${jam(row.susulan_at)}`;
}

/** Label pendek untuk dokumen cetak, tanpa mengulang kata "pemeriksaan" tiap baris. */
export function labelSusulanRingkas(row: SusulanFields | null | undefined): string | null {
  if (!row?.susulan_at) return null;
  const waktu = new Date(row.susulan_at);
  if (Number.isNaN(waktu.getTime())) return null;
  const oleh = row.susulan_by_name?.trim();
  return `Susulan${oleh ? ` · ${oleh}` : ""} · ${jam(row.susulan_at)}`;
}
