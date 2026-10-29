// Uang muka minimal tagihan klinik (keputusan Andri, 29 Oktober 2026).
//
// Berlaku untuk SEMUA tagihan klinik — rawat jalan maupun tiap tahap rawat inap —
// tetapi TIDAK untuk kasir petshop dan TIDAK untuk pelunasan piutang menyusul.
// Angkanya satu untuk seluruh perusahaan, disetel OWNER/ADMIN di Pengaturan →
// Operasional Klinik. Database yang menegakkannya (clinic_private.enforce_min_dp);
// fungsi di sini hanya supaya layar menampilkan angka yang sama persis.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export const DP_MINIMAL_BAWAAN = 50;
/** Peran yang boleh menerima di bawah minimum, dengan alasan yang dicatat. */
export const PERAN_PENEROBOS_DP = ["OWNER", "ADMIN", "FINANCE"] as const;

/**
 * Rupiah minimal yang harus diterima sebelum tagihan boleh disimpan belum lunas.
 *
 * Dibulatkan KE ATAS, sama dengan `ceil()` di database: kalau layar membulatkan ke
 * bawah, kasir menerima satu rupiah kurang dan penyimpanannya ditolak tanpa sebab
 * yang terlihat.
 */
export function uangMukaMinimal(total: number, persen: number): number {
  const nilai = Number(total) || 0;
  const rate = Math.min(100, Math.max(0, Number(persen) || 0));
  if (nilai <= 0 || rate <= 0) return 0;
  return Math.ceil((nilai * rate) / 100);
}

/** Sisa yang masih kurang dari minimum (0 = sudah cukup atau sudah lunas). */
export function kurangUangMuka(total: number, diterima: number, persen: number): number {
  const nilai = Number(total) || 0;
  const masuk = Number(diterima) || 0;
  if (nilai <= 0 || masuk >= nilai) return 0;
  return Math.max(0, uangMukaMinimal(nilai, persen) - masuk);
}

export function bolehMenerobosDp(role: string | null | undefined): boolean {
  return !!role && (PERAN_PENEROBOS_DP as readonly string[]).includes(role);
}

/** Pesan yang sama untuk layar dan untuk menerjemahkan penolakan database. */
export function pesanDpMinimal(total: number, diterima: number, persen: number): string | null {
  const kurang = kurangUangMuka(total, diterima, persen);
  if (kurang <= 0) return null;
  const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
  return `Uang muka minimal ${persen}% = ${rp(uangMukaMinimal(total, persen))}. Kurang ${rp(kurang)}.`;
}

/** Baca setelan minimum; baris hilang atau gagal dibaca = pakai bawaan 50%. */
export async function getDpMinimalPercent(supabase: AnyClient): Promise<number> {
  try {
    const { data } = await supabase
      .from("clinic_billing_settings").select("min_dp_percent").eq("id", true).maybeSingle();
    if (!data) return DP_MINIMAL_BAWAAN;
    const nilai = Number(data.min_dp_percent);
    return Number.isFinite(nilai) && nilai >= 0 && nilai <= 100 ? nilai : DP_MINIMAL_BAWAAN;
  } catch {
    return DP_MINIMAL_BAWAAN;
  }
}
