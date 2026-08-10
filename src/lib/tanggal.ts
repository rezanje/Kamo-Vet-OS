// Format tanggal LOKAL jadi "YYYY-MM-DD".
//
// Jangan pakai toISOString() untuk ini: Date yang dibuat dari "2026-08-06T00:00:00"
// adalah tengah malam waktu setempat (WIB = UTC+7), dan toISOString() memundurkannya
// jadi "2026-08-05". Kesalahan sehari begini bikin cuti, jadwal, dan saldo awal
// laporan meleset satu hari.
export function tanggalLokal(d: Date): string {
  const bln = String(d.getMonth() + 1).padStart(2, "0");
  const hari = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${bln}-${hari}`;
}

// "Hari ini" menurut WIB, apa pun zona waktu servernya.
//
// Fungsi Vercel jalan di UTC. `new Date().toISOString().slice(0,10)` karenanya
// menghasilkan tanggal KEMARIN untuk transaksi jam 00:00–07:00 WIB — struk, jurnal,
// dan saldo shift jadi jatuh di hari yang salah. Jangan pakai toISOString mentah
// untuk "hari ini"; pakai fungsi ini.
export function hariIniWIB(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

export function geserHari(tanggal: string, jumlahHari: number): string {
  const d = new Date(`${tanggal}T00:00:00`);
  d.setDate(d.getDate() + jumlahHari);
  return tanggalLokal(d);
}

// Semua tanggal antara dua tanggal (inklusif).
export function rentangTanggal(dari: string, sampai: string): string[] {
  const hasil: string[] = [];
  const d = new Date(`${dari}T00:00:00`);
  const akhir = new Date(`${sampai}T00:00:00`);
  while (d <= akhir && hasil.length < 366) {
    hasil.push(tanggalLokal(d));
    d.setDate(d.getDate() + 1);
  }
  return hasil;
}
