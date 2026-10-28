// Aturan gaji (migrasi 0087) — logika murni, dites di __tests__/payroll-aturan.test.ts.
//
// Semua nominal berasal dari pengaturan, tidak ada angka yang dipatok di kode.
// Bawaan nol: sebelum pemilik menetapkan aturannya, tidak ada gaji yang terpotong.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type AturanGaji = {
  telat_mulai_menit: number;
  telat_blok_menit: number;
  telat_nominal_per_blok: number;
  telat_maks: number;      // 0 = tanpa batas atas
  bolos_per_hari: number;
  lembur_per_jam: number;
};

export const ATURAN_KOSONG: AturanGaji = {
  telat_mulai_menit: 1,
  telat_blok_menit: 5,
  telat_nominal_per_blok: 0,
  telat_maks: 0,
  bolos_per_hari: 0,
  lembur_per_jam: 0,
};

// Berblok, bukan per menit: telat 6 menit dengan blok 5 menit = 2 blok.
// Blok yang belum penuh tetap dihitung penuh — itu yang bikin aturannya menggigit.
export function potonganTelat(menitTelat: number, a: AturanGaji): number {
  const menit = Math.floor(Number(menitTelat) || 0);
  if (menit <= 0 || menit < a.telat_mulai_menit) return 0;
  if (a.telat_nominal_per_blok <= 0 || a.telat_blok_menit <= 0) return 0;

  const blok = Math.ceil(menit / a.telat_blok_menit);
  const nominal = blok * a.telat_nominal_per_blok;
  return a.telat_maks > 0 ? Math.min(nominal, a.telat_maks) : nominal;
}

// Telat dihitung dari jam shift orang itu, bukan jam kantor global.
// Absen lebih awal = 0, bukan angka negatif.
export function menitTelat(jamShift: string | null, jamAbsen: string | null): number {
  if (!jamShift || !jamAbsen) return 0;
  const ke = (s: string) => {
    const [h, m] = s.slice(0, 5).split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  return Math.max(0, ke(jamAbsen) - ke(jamShift));
}

export const ATURAN_GAJI_BELUM_DISIMPAN =
  "Aturan gaji belum pernah disimpan. OWNER perlu menyimpannya dulu di Pengaturan → Aturan gaji.";

// Baca baris tunggal aturan gaji. `tersimpan: false` = barisnya memang belum ada
// (bukan gagal baca) — layar tetap bisa dibuka supaya OWNER bisa mengisinya.
export async function bacaAturanGaji(supabase: AnyClient): Promise<{ aturan: AturanGaji; tersimpan: boolean }> {
  const { data, error } = await supabase
    .from("payroll_settings")
    .select("telat_mulai_menit, telat_blok_menit, telat_nominal_per_blok, telat_maks, bolos_per_hari, lembur_per_jam")
    .eq("id", true).maybeSingle();
  if (error) throw new Error("Aturan gaji belum dapat diverifikasi. Coba muat ulang.");
  if (!data) return { aturan: { ...ATURAN_KOSONG }, tersimpan: false };
  return { aturan: {
    telat_mulai_menit: Number(data.telat_mulai_menit) || 0,
    telat_blok_menit: Number(data.telat_blok_menit) || 5,
    telat_nominal_per_blok: Number(data.telat_nominal_per_blok) || 0,
    telat_maks: Number(data.telat_maks) || 0,
    bolos_per_hari: Number(data.bolos_per_hari) || 0,
    lembur_per_jam: Number(data.lembur_per_jam) || 0,
  }, tersimpan: true };
}

// Untuk menghitung gaji: baris yang belum ada atau tersembunyi RLS tidak boleh
// dianggap sebagai tarif nol yang sudah diputuskan pemilik.
export async function getAturanGaji(supabase: AnyClient): Promise<AturanGaji> {
  const { aturan, tersimpan } = await bacaAturanGaji(supabase);
  if (!tersimpan) throw new Error(ATURAN_GAJI_BELUM_DISIMPAN);
  return aturan;
}
