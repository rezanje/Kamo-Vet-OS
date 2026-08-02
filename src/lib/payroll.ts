// Hitungan slip gaji (migrasi 0090) — murni, dites di __tests__/payroll.test.ts.
//
// Semua angka berasal dari data yang sudah ada: jadwal shift, absensi, cuti disetujui,
// lembur disetujui, komponen gaji, cicilan kasbon, dan reimburse disetujui.

import { potonganTelat, menitTelat, type AturanGaji } from "./payroll-aturan";
import { cicilanPeriode } from "./kasbon";

export type HariJadwal = {
  tanggal: string;
  isLibur: boolean;
  jamMasuk: string | null;      // jam shift yang dijadwalkan
};

export type HariAbsen = {
  tanggal: string;
  jamMasuk: string | null;
};

export type KomponenDipakai = { tipe: "tunjangan" | "potongan"; nominal: number };

export type InputGaji = {
  gajiPokok: number;
  jadwal: HariJadwal[];
  absen: HariAbsen[];
  tanggalCuti: string[];        // cuti/izin/sakit yang SUDAH disetujui
  jamLembur: number;            // total jam lembur yang sudah disetujui
  komponen: KomponenDipakai[];
  reimburse: number;            // reimburse disetujui yang dibayar periode ini
  komisi: number;               // komisi penjualan periode ini (migrasi 0091)
  kasbon: { jumlah: number; tenor: number; sudahDibayar: number } | null;
  penyesuaian: number;          // koreksi manual pemilik (boleh negatif)
  aturan: AturanGaji;
};

export type RincianGaji = {
  gajiPokok: number;
  tunjangan: number;
  upahLembur: number;
  reimburse: number;
  komisi: number;
  potonganTetap: number;
  potonganTelat: number;
  potonganBolos: number;
  cicilanKasbon: number;
  penyesuaian: number;
  total: number;
  hariKerja: number;
  hariHadir: number;
  hariBolos: number;
  menitTelat: number;
  jamLembur: number;
};

export function hitungGaji(i: InputGaji): RincianGaji {
  const absenPer = new Map(i.absen.map((a) => [a.tanggal, a]));
  const cuti = new Set(i.tanggalCuti);

  // Hari kerja = hari yang DIJADWALKAN masuk. Hari libur terjadwal tidak dihitung
  // sama sekali, jadi tidak mungkin jadi bolos.
  const hariKerja = i.jadwal.filter((h) => !h.isLibur);

  let menitTelatTotal = 0;
  let potTelat = 0;
  let hadir = 0;
  let bolos = 0;

  for (const h of hariKerja) {
    const a = absenPer.get(h.tanggal);
    if (a?.jamMasuk) {
      hadir += 1;
      const telat = menitTelat(h.jamMasuk, a.jamMasuk);
      menitTelatTotal += telat;
      // Potongan dihitung PER HARI supaya batas atas harian berlaku benar —
      // menjumlahkan menit sebulan lalu memotong sekali akan salah besar.
      potTelat += potonganTelat(telat, i.aturan);
      continue;
    }
    // Tidak absen: bolos, kecuali hari itu memang cuti/izin yang sudah disetujui.
    if (!cuti.has(h.tanggal)) bolos += 1;
  }

  const tunjangan = i.komponen.filter((k) => k.tipe === "tunjangan").reduce((a, k) => a + Number(k.nominal), 0);
  const potonganTetap = i.komponen.filter((k) => k.tipe === "potongan").reduce((a, k) => a + Number(k.nominal), 0);

  const upahLembur = Math.round(Number(i.jamLembur) * i.aturan.lembur_per_jam);
  const potBolos = Math.round(bolos * i.aturan.bolos_per_hari);
  const cicilan = i.kasbon
    ? cicilanPeriode(i.kasbon.jumlah, i.kasbon.tenor, i.kasbon.sudahDibayar)
    : 0;

  const komisi = Math.round(Number(i.komisi) || 0);

  const total =
    Number(i.gajiPokok) + tunjangan + upahLembur + Number(i.reimburse) + komisi + Number(i.penyesuaian)
    - potonganTetap - potTelat - potBolos - cicilan;

  return {
    gajiPokok: Number(i.gajiPokok),
    tunjangan,
    upahLembur,
    reimburse: Number(i.reimburse),
    komisi,
    potonganTetap,
    potonganTelat: potTelat,
    potonganBolos: potBolos,
    cicilanKasbon: cicilan,
    penyesuaian: Number(i.penyesuaian),
    // Gaji bersih tidak boleh negatif: potongan yang melebihi gaji ditahan, bukan
    // ditagihkan diam-diam lewat slip.
    total: Math.max(0, Math.round(total)),
    hariKerja: hariKerja.length,
    hariHadir: hadir,
    hariBolos: bolos,
    menitTelat: menitTelatTotal,
    jamLembur: Number(i.jamLembur),
  };
}

export const AKUN_BEBAN_GAJI = "5201";

// Baris jurnal penggajian satu periode (semua karyawan digabung).
//   Dr Beban Gaji  = gaji bersih + cicilan kasbon yang dipotong
//   Cr Piutang Karyawan = cicilan kasbon (utang karyawan berkurang, bukan beban baru)
//   Cr Kas/Bank    = gaji bersih yang benar-benar keluar
// Bruto diturunkan dari netto + cicilan supaya jurnal SELALU seimbang, termasuk saat
// gaji bersih sempat dibatasi nol.
export function jurnalPenggajian(
  kasCode: string,
  akunPiutangKaryawan: string,
  netto: number,
  cicilanKasbon: number,
): { code: string; debit: number; credit: number }[] {
  const bersih = Math.round(Number(netto) || 0);
  const cicilan = Math.round(Number(cicilanKasbon) || 0);
  const lines = [{ code: AKUN_BEBAN_GAJI, debit: bersih + cicilan, credit: 0 }];
  if (cicilan > 0) lines.push({ code: akunPiutangKaryawan, debit: 0, credit: cicilan });
  lines.push({ code: kasCode, debit: 0, credit: bersih });
  return lines;
}
