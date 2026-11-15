// C1: "Salin dari bulan lalu" di papan jadwal — murni, dites di __tests__/jadwal-salin.test.ts.
//
// Pola per HARI yang sama: tanggal bulan ini mengambil shift dari 4 minggu sebelumnya (hari yang
// sama: Senin ← Senin). Tanggal 29–31 jatuh di bulan yang sama bila mundur 4 minggu, jadi mundur
// 5 minggu. Hasilnya selalu tanggal di bulan sebelumnya dengan hari yang sama.

export function tanggalSumberSalin(target: string): string {
  const d = new Date(`${target}T00:00:00Z`);
  const bulanTarget = target.slice(0, 7);
  d.setUTCDate(d.getUTCDate() - 28);
  if (d.toISOString().slice(0, 7) === bulanTarget) d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

export function tanggalBulan(bulan: string): string[] {
  const [thn, bln] = bulan.split("-").map(Number);
  const jumlah = new Date(Date.UTC(thn, bln, 0)).getUTCDate();
  return Array.from({ length: jumlah }, (_, i) => `${bulan}-${String(i + 1).padStart(2, "0")}`);
}

// Rentang tanggal sumber yang perlu dibaca untuk menyalin `bulan`.
export function rentangSumber(bulan: string): { dari: string; sampai: string } {
  const hari = tanggalBulan(bulan);
  const sumber = hari.map(tanggalSumberSalin).sort();
  return { dari: sumber[0], sampai: sumber[sumber.length - 1] };
}

export type SelJadwal = { employee_id: string; tanggal: string; shift_id: string };

export type RencanaSalin = {
  isi: SelJadwal[];          // akan ditulis
  dilewati: number;          // sudah terisi & tidak boleh ditimpa
  shiftTidakAktif: number;   // sumbernya memakai shift yang sudah nonaktif / bukan cabang ini
};

export function rencanaSalinJadwal(input: {
  bulan: string;
  karyawan: string[];
  sumber: SelJadwal[];       // jadwal bulan lalu (rentangSumber)
  sekarang: SelJadwal[];     // jadwal yang sudah ada di bulan tujuan
  shiftBoleh: Set<string>;   // shift aktif yang berlaku di cabang ini
  timpa: boolean;
}): RencanaSalin {
  const k = (e: string, t: string) => `${e}|${t}`;
  const sumberPer = new Map(input.sumber.map((s) => [k(s.employee_id, s.tanggal), s.shift_id]));
  const sekarangPer = new Map(input.sekarang.map((s) => [k(s.employee_id, s.tanggal), s.shift_id]));
  const isi: SelJadwal[] = [];
  let dilewati = 0;
  let shiftTidakAktif = 0;
  for (const emp of input.karyawan) {
    for (const tanggal of tanggalBulan(input.bulan)) {
      const shift = sumberPer.get(k(emp, tanggalSumberSalin(tanggal)));
      if (!shift) continue;
      if (!input.shiftBoleh.has(shift)) { shiftTidakAktif++; continue; }
      const ada = sekarangPer.get(k(emp, tanggal));
      if (ada === shift) continue;
      if (ada && !input.timpa) { dilewati++; continue; }
      isi.push({ employee_id: emp, tanggal, shift_id: shift });
    }
  }
  return { isi, dilewati, shiftTidakAktif };
}

export function bulanSebelumnya(bulan: string): string {
  const [thn, bln] = bulan.split("-").map(Number);
  return bln === 1 ? `${thn - 1}-12` : `${thn}-${String(bln - 1).padStart(2, "0")}`;
}
