// C1: telat, pulang cepat, dan lembur dihitung dari SHIFT orang itu (bukan jam kantor global).
// Murni — dipakai laporan absensi, layar /hris/absensi, dan penggajian (payroll-aturan.menitTelat).
//
// Baris absensi bertanggal = tanggal MULAI shift (migrasi 20261118640000). Jam disimpan tanpa
// tanggal, jadi untuk shift yang lewat tengah malam jam absennya harus "diputar" ke hari yang benar.

const SEHARI = 24 * 60;

// 'HH:MM[:SS]' → menit sejak tengah malam; kosong/rusak = null (bukan jam 00:00).
export function menitJam(jam: string | null | undefined): number | null {
  if (!jam) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(jam.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

// Menit telat dari jam masuk shift. Selisih lebih dari 12 jam dianggap melewati tengah malam:
// shift 22:00 diabsen 00:30 = telat 150 menit, bukan "lebih awal 21,5 jam".
export function menitTelatShift(jamShift: string | null | undefined, jamAbsen: string | null | undefined): number {
  const shift = menitJam(jamShift);
  const absen = menitJam(jamAbsen);
  if (shift == null || absen == null) return 0;
  let selisih = absen - shift;
  if (selisih < -SEHARI / 2) selisih += SEHARI;
  else if (selisih > SEHARI / 2) selisih -= SEHARI;
  return Math.max(0, selisih);
}

// Menit jam pulang, dihitung dari tengah malam HARI MULAI shift (boleh > 1440 untuk keesokan harinya).
// Pulang sebelum (jam masuk shift − 3 jam) dianggap sudah keesokan harinya.
function pulangRelatif(shiftMasuk: number, jamPulang: number): number {
  return jamPulang >= shiftMasuk - 180 ? jamPulang : jamPulang + SEHARI;
}

function akhirShift(shiftMasuk: number, shiftPulang: number): number {
  return shiftPulang > shiftMasuk ? shiftPulang : shiftPulang + SEHARI;
}

export function menitPulangCepat(
  shiftMasuk: string | null | undefined, shiftPulang: string | null | undefined, jamPulang: string | null | undefined,
): number {
  const sm = menitJam(shiftMasuk);
  const sp = menitJam(shiftPulang);
  const p = menitJam(jamPulang);
  if (sm == null || sp == null || p == null) return 0;
  return Math.max(0, akhirShift(sm, sp) - pulangRelatif(sm, p));
}

export function menitLemburShift(
  shiftMasuk: string | null | undefined, shiftPulang: string | null | undefined, jamPulang: string | null | undefined,
): number {
  const sm = menitJam(shiftMasuk);
  const sp = menitJam(shiftPulang);
  const p = menitJam(jamPulang);
  if (sm == null || sp == null || p == null) return 0;
  return Math.max(0, pulangRelatif(sm, p) - akhirShift(sm, sp));
}

// Jam shift sudah lewat (untuk menentukan Alpha hari ini): akhir shift ≤ sekarang.
export function shiftSudahSelesai(tanggal: string, shiftMasuk: string | null, shiftPulang: string | null, hariIni: string, menitSekarang: number): boolean {
  if (tanggal < hariIni) {
    // Shift malam kemarin baru selesai pagi ini.
    const sm = menitJam(shiftMasuk);
    const sp = menitJam(shiftPulang);
    if (sm == null || sp == null || sp > sm) return true;
    const kemarin = new Date(`${hariIni}T00:00:00Z`);
    kemarin.setUTCDate(kemarin.getUTCDate() - 1);
    return tanggal < kemarin.toISOString().slice(0, 10) || menitSekarang >= sp;
  }
  if (tanggal > hariIni) return false;
  const sm = menitJam(shiftMasuk);
  const sp = menitJam(shiftPulang);
  if (sm == null || sp == null) return false;
  return sp > sm && menitSekarang >= sp;
}

// Menit sejak tengah malam WIB saat ini (server jalan di UTC).
export function menitSekarangWIB(): number {
  const wib = new Date(Date.now() + 7 * 3600_000);
  return wib.getUTCHours() * 60 + wib.getUTCMinutes();
}
