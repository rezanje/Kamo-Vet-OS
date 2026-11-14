// Perhitungan laporan HRIS — pure, supaya angkanya bisa diuji tanpa database.
//
// Yang non-trivial di sini cuma satu: menentukan "telat" dan "lembur" dari jam
// absen. Sisanya penjumlahan biasa, tapi tetap ditaruh di sini karena laporan
// gaji & absensi dibaca orang untuk mengambil keputusan soal uang.

import { menitTelatShift, menitPulangCepat, menitLemburShift, shiftSudahSelesai } from "./absensi-shift";

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

// ── C1: rekap berbasis JADWAL SHIFT (sama dengan penggajian) ────────────────────
// Telat/pulang cepat/lembur dihitung dari shift orang itu pada tanggal itu. Hari terjadwal masuk
// tanpa absen dan tanpa cuti/izin/sakit yang disetujui = Alpha (dihitung, tidak ditulis ke database).

export type JadwalLaporan = {
  employee_id: string; tanggal: string; is_libur: boolean; jam_masuk: string | null; jam_pulang: string | null;
};
export type AbsenLaporan = BarisAbsensi & { tanggal: string };
export type CutiLaporan = { employee_id: string; jenis: string; tanggal_mulai: string; tanggal_selesai: string | null };

export type RekapAbsensiJadwal = RekapAbsensi & {
  pulangCepat: number;        // berapa HARI pulang sebelum jam shift selesai
  menitPulangCepat: number;
  tanpaJadwal: number;        // hari hadir tanpa jadwal / pada jadwal libur (telat tidak bisa dihitung)
  hariTerjadwal: number;      // hari kerja terjadwal (bukan libur) dalam periode
};

export const rekapKosongJadwal = (employee_id: string): RekapAbsensiJadwal => ({
  employee_id, hadir: 0, izin: 0, sakit: 0, alpha: 0, cuti: 0, telat: 0, menitTelat: 0, menitLembur: 0,
  pulangCepat: 0, menitPulangCepat: 0, tanpaJadwal: 0, hariTerjadwal: 0,
});

function tanggalDalam(dari: string, sampai: string): string[] {
  const out: string[] = [];
  const d = new Date(`${dari}T00:00:00Z`);
  const akhir = new Date(`${sampai}T00:00:00Z`);
  while (d <= akhir && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const STATUS_TIDAK_MASUK = ["Izin", "Sakit", "Alpha", "Cuti"];

export function rekapAbsensiJadwal(input: {
  jadwal: JadwalLaporan[];
  absen: AbsenLaporan[];
  cuti: CutiLaporan[];            // hanya yang SUDAH disetujui
  awal: string; akhir: string;    // periode inklusif (YYYY-MM-DD)
  hariIni: string;                // WIB
  menitSekarang: number;          // menit sejak tengah malam WIB
  toleransiMenit: number;
}): Map<string, RekapAbsensiJadwal> {
  const out = new Map<string, RekapAbsensiJadwal>();
  const ambil = (id: string) => {
    let r = out.get(id);
    if (!r) { r = rekapKosongJadwal(id); out.set(id, r); }
    return r;
  };
  const k = (emp: string, tgl: string) => `${emp}|${tgl}`;
  const jadwalPer = new Map(input.jadwal.map((j) => [k(j.employee_id, j.tanggal), j]));
  const absenPer = new Map(input.absen.map((a) => [k(a.employee_id, a.tanggal), a]));
  const cutiPer = new Map<string, string>();
  for (const c of input.cuti) {
    if (c.jenis === "Lembur") continue;
    const dari = c.tanggal_mulai < input.awal ? input.awal : c.tanggal_mulai;
    const sampaiAsli = c.tanggal_selesai ?? c.tanggal_mulai;
    const sampai = sampaiAsli > input.akhir ? input.akhir : sampaiAsli;
    if (dari > sampai) continue;
    for (const t of tanggalDalam(dari, sampai)) cutiPer.set(k(c.employee_id, t), c.jenis);
  }

  for (const a of input.absen) {
    if (a.tanggal < input.awal || a.tanggal > input.akhir) continue;
    const r = ambil(a.employee_id);
    switch (a.status) {
      case "Hadir": r.hadir++; break;
      case "Izin": r.izin++; break;
      case "Sakit": r.sakit++; break;
      case "Alpha": r.alpha++; break;
      case "Cuti": r.cuti++; break;
      default: if (a.jam_masuk) r.hadir++;
    }
    const masuk = a.status === "Hadir" || (a.jam_masuk && !STATUS_TIDAK_MASUK.includes(a.status));
    if (!masuk) continue;
    const j = jadwalPer.get(k(a.employee_id, a.tanggal));
    if (!j || j.is_libur || !j.jam_masuk || !j.jam_pulang) { r.tanpaJadwal++; continue; }
    const t = menitTelatShift(j.jam_masuk, a.jam_masuk);
    if (t > Math.max(0, input.toleransiMenit)) { r.telat++; r.menitTelat += t; }
    const pc = menitPulangCepat(j.jam_masuk, j.jam_pulang, a.jam_pulang);
    if (pc > 0) { r.pulangCepat++; r.menitPulangCepat += pc; }
    r.menitLembur += menitLemburShift(j.jam_masuk, j.jam_pulang, a.jam_pulang);
  }

  for (const j of input.jadwal) {
    if (j.is_libur || j.tanggal < input.awal || j.tanggal > input.akhir) continue;
    const r = ambil(j.employee_id);
    r.hariTerjadwal++;
    const key = k(j.employee_id, j.tanggal);
    if (absenPer.has(key)) continue;                 // sudah dihitung dari barisnya
    const jenisCuti = cutiPer.get(key);
    if (jenisCuti) {
      if (jenisCuti === "Sakit") r.sakit++;
      else if (jenisCuti === "Izin") r.izin++;
      else r.cuti++;
      continue;
    }
    if (shiftSudahSelesai(j.tanggal, j.jam_masuk, j.jam_pulang, input.hariIni, input.menitSekarang)) r.alpha++;
  }
  return out;
}
