// Laporan Visit rawat inap — logika murni (tanpa database), dites di
// __tests__/laporan-visit.test.ts. A4, meeting 12 Nov 2026.
//
// Dasar insentif dokter/paramedis klinik: berapa kali ia melakukan visit pasien
// rawat inap. Sumbernya "Laporan Rawat Inap Harian" (inpatient_daily_logs).
//
// ATURAN HITUNG:
//   - Satu baris berjenis "Visit dokter" (log_kind = doctor_visit) = 1 visit untuk
//     dokter visitnya DAN 1 visit untuk paramedis yang tercatat di baris itu.
//   - Baris "Pemantauan" (monitoring) BUKAN visit; ditampilkan terpisah di kolom
//     Pemantauan supaya tetap terlihat, tetapi tidak menambah jumlah visit.
//   - Baris lama tanpa ID karyawan dikelompokkan menurut nama yang tercatat.
//   - Nilai rupiah per visit BELUM dihitung (pertanyaan [?] di to-do A4 masih terbuka).

export type PeranVisit = "Dokter" | "Paramedis";
export const PERAN_VISIT: PeranVisit[] = ["Dokter", "Paramedis"];

export type JenisCatatan = "doctor_visit" | "monitoring" | null;

export type BarisVisit = {
  id: string;
  /** Tanggal catatan (YYYY-MM-DD, WIB). */
  tanggal: string;
  /** ISO, hanya untuk pengurutan & jam. */
  waktu: string;
  jenis: JenisCatatan;
  inpatientId: string;
  cabangId: string | null;
  cabang: string;
  pasien: string;
  pemilik: string;
  kondisi: string;
  tindakan: string;
  dokterId: string | null;
  dokterNama: string | null;
  paramedisId: string | null;
  paramedisNama: string | null;
};

/** Pasangan (catatan × orang × peran). */
export type AtribusiVisit = { baris: BarisVisit; kunci: string; employeeId: string | null; nama: string; peran: PeranVisit };

const kunciOrang = (id: string | null, nama: string | null): string | null =>
  id ? `id:${id}` : nama?.trim() ? `nama:${nama.trim().toLocaleLowerCase("id-ID")}` : null;

export function atribusiVisit(rows: readonly BarisVisit[]): AtribusiVisit[] {
  return rows.flatMap((baris) => {
    const hasil: AtribusiVisit[] = [];
    const dokter = kunciOrang(baris.dokterId, baris.dokterNama);
    if (dokter) hasil.push({ baris, kunci: dokter, employeeId: baris.dokterId, nama: baris.dokterNama?.trim() || "—", peran: "Dokter" });
    const paramedis = kunciOrang(baris.paramedisId, baris.paramedisNama);
    if (paramedis) hasil.push({ baris, kunci: paramedis, employeeId: baris.paramedisId, nama: baris.paramedisNama?.trim() || "—", peran: "Paramedis" });
    return hasil;
  });
}

export type SaringanVisit = { cabangId?: string; employeeId?: string; peran?: PeranVisit | "" };

export function saringVisit(rows: readonly AtribusiVisit[], s: SaringanVisit): AtribusiVisit[] {
  return rows.filter(({ baris, employeeId, peran }) =>
    (!s.cabangId || baris.cabangId === s.cabangId)
    && (!s.employeeId || employeeId === s.employeeId)
    && (!s.peran || peran === s.peran));
}

export const hitungSebagaiVisit = (baris: BarisVisit): boolean => baris.jenis === "doctor_visit";

export type RekapVisit = {
  kunci: string;
  employeeId: string | null;
  nama: string;
  peran: PeranVisit;
  /** Jumlah visit — dasar insentif. */
  visit: number;
  /** Pasien rawat inap berbeda yang divisit. */
  pasien: number;
  /** Hari berbeda dengan minimal satu visit. */
  hari: number;
  /** Catatan pemantauan (bukan visit) — informasi saja. */
  pemantauan: number;
};

/** Rekap per orang per peran. Satu orang yang tercatat sebagai dokter dan paramedis muncul dua baris. */
export function rekapVisit(rows: readonly AtribusiVisit[]): RekapVisit[] {
  type Akum = RekapVisit & { setPasien: Set<string>; setHari: Set<string> };
  const peta = new Map<string, Akum>();
  for (const { baris, kunci, employeeId, nama, peran } of rows) {
    const id = `${peran}|${kunci}`;
    let akun = peta.get(id);
    if (!akun) {
      akun = { kunci, employeeId, nama, peran, visit: 0, pasien: 0, hari: 0, pemantauan: 0, setPasien: new Set(), setHari: new Set() };
      peta.set(id, akun);
    }
    if (hitungSebagaiVisit(baris)) {
      akun.visit += 1;
      akun.setPasien.add(baris.inpatientId);
      akun.setHari.add(baris.tanggal);
    } else {
      akun.pemantauan += 1;
    }
  }
  return [...peta.values()]
    .map((a) => ({
      kunci: a.kunci, employeeId: a.employeeId, nama: a.nama, peran: a.peran,
      visit: a.visit, pasien: a.setPasien.size, hari: a.setHari.size, pemantauan: a.pemantauan,
    }))
    .sort((a, b) => PERAN_VISIT.indexOf(a.peran) - PERAN_VISIT.indexOf(b.peran)
      || b.visit - a.visit || a.nama.localeCompare(b.nama, "id") || a.kunci.localeCompare(b.kunci));
}

/** Total catatan (tiap baris sekali): visit dokter vs pemantauan. */
export function totalCatatan(rows: readonly BarisVisit[]): { visit: number; pemantauan: number; pasien: number } {
  const pasien = new Set<string>();
  let visit = 0, pemantauan = 0;
  for (const baris of rows) {
    if (hitungSebagaiVisit(baris)) { visit += 1; pasien.add(baris.inpatientId); } else pemantauan += 1;
  }
  return { visit, pemantauan, pasien: pasien.size };
}

export const LABEL_JENIS_CATATAN = (jenis: JenisCatatan): string =>
  jenis === "doctor_visit" ? "Visit dokter" : jenis === "monitoring" ? "Pemantauan" : "Lama (tanpa jenis)";
