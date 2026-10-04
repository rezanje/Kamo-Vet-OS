const NAMA = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
export function tanggalValid(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function geserTanggal(value: string, days: number) {
  const d = new Date(`${value}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function hariPeriode(bulan: string, minggu?: string) {
  if (!tanggalValid(`${bulan}-01`)) throw new Error('Bulan tidak valid');
  let awal = `${bulan}-01`;
  let jumlah = new Date(Date.UTC(Number(bulan.slice(0, 4)), Number(bulan.slice(5)), 0)).getUTCDate();
  if (minggu) {
    if (!tanggalValid(minggu)) throw new Error('Tanggal minggu tidak valid');
    awal = geserTanggal(minggu, -((new Date(`${minggu}T00:00:00Z`).getUTCDay() + 6) % 7)); jumlah = 7;
  }
  return Array.from({length: jumlah}, (_, i) => {
    const tanggal = geserTanggal(awal, i), d = new Date(`${tanggal}T00:00:00Z`), dow = d.getUTCDay();
    return {tanggal, hari: d.getUTCDate(), namaHari: NAMA[dow], akhirPekan: dow === 0};
  });
}
