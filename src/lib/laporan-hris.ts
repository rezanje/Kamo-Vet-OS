// Perhitungan laporan HRIS — pure, supaya angkanya bisa diuji tanpa database.
//
// Yang non-trivial di sini cuma satu: menentukan "telat" dan "lembur" dari jam
// absen. Sisanya penjumlahan biasa, tapi tetap ditaruh di sini karena laporan
// gaji & absensi dibaca orang untuk mengambil keputusan soal uang.

export type JamKerja = {
  jamMasukStandar: string;      // 'HH:MM' atau 'HH:MM:SS'
  jamPulangStandar: string;
  toleransiMenit: number;
};

export const JAM_KERJA_DEFAULT: JamKerja = {
  jamMasukStandar: "08:00",
  jamPulangStandar: "17:00",
  toleransiMenit: 10,
};

// 'HH:MM[:SS]' → menit sejak tengah malam. null kalau tidak terbaca —
// jam absen yang kosong bukan berarti jam 00:00.
export function keMenit(jam: string | null | undefined): number | null {
  if (!jam) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(jam.trim());
  if (!m) return null;
  const jamNya = Number(m[1]);
  const menit = Number(m[2]);
  if (jamNya > 23 || menit > 59) return null;
  return jamNya * 60 + menit;
}

// Menit keterlambatan. 0 = tidak telat. Toleransi dipakai penuh: datang tepat
// di batas toleransi belum dihitung telat.
export function menitTelat(jamMasuk: string | null | undefined, k: JamKerja): number {
  const masuk = keMenit(jamMasuk);
  const standar = keMenit(k.jamMasukStandar);
  if (masuk == null || standar == null) return 0;
  const batas = standar + Math.max(0, k.toleransiMenit);
  return masuk > batas ? masuk - standar : 0;   // dihitung dari jam standar, bukan dari batas
}

// Menit lembur. Pulang sebelum jam standar bukan lembur negatif — itu pulang cepat,
// urusan lain yang tidak dicampur ke sini.
export function menitLembur(jamPulang: string | null | undefined, k: JamKerja): number {
  const pulang = keMenit(jamPulang);
  const standar = keMenit(k.jamPulangStandar);
  if (pulang == null || standar == null) return 0;
  return pulang > standar ? pulang - standar : 0;
}

export type BarisAbsensi = {
  employee_id: string;
  status: string;                  // Hadir / Izin / Sakit / Alpha / Cuti
  jam_masuk: string | null;
  jam_pulang: string | null;
};

export type RekapAbsensi = {
  employee_id: string;
  hadir: number; izin: number; sakit: number; alpha: number; cuti: number;
  telat: number;            // berapa HARI telat
  menitTelat: number;       // total menit
  menitLembur: number;
};

export function rekapAbsensi(baris: BarisAbsensi[], k: JamKerja): Map<string, RekapAbsensi> {
  const out = new Map<string, RekapAbsensi>();
  for (const b of baris) {
    const r = out.get(b.employee_id) ?? {
      employee_id: b.employee_id,
      hadir: 0, izin: 0, sakit: 0, alpha: 0, cuti: 0,
      telat: 0, menitTelat: 0, menitLembur: 0,
    };

    switch (b.status) {
      case "Hadir": r.hadir++; break;
      case "Izin":  r.izin++;  break;
      case "Sakit": r.sakit++; break;
      case "Alpha": r.alpha++; break;
      case "Cuti":  r.cuti++;  break;
      // Status di luar daftar tidak dibuang diam-diam — ikut dihitung hadir
      // kalau ada jam masuknya, supaya jam kerjanya tidak hilang dari rekap.
      default: if (b.jam_masuk) r.hadir++;
    }

    // Telat & lembur hanya masuk akal untuk hari yang benar-benar masuk kerja.
    if (b.status === "Hadir" || (b.jam_masuk && !["Izin", "Sakit", "Alpha", "Cuti"].includes(b.status))) {
      const t = menitTelat(b.jam_masuk, k);
      if (t > 0) { r.telat++; r.menitTelat += t; }
      r.menitLembur += menitLembur(b.jam_pulang, k);
    }

    out.set(b.employee_id, r);
  }
  return out;
}

// "1j 25m" — lebih kebaca daripada "85 menit" di kolom tabel.
export function jamMenit(total: number): string {
  const t = Math.max(0, Math.round(total));
  if (t === 0) return "—";
  const j = Math.floor(t / 60);
  const m = t % 60;
  return j > 0 ? `${j}j ${m}m` : `${m}m`;
}
