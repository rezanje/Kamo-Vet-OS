// Transfer antar rekening kas/bank (migrasi 0068) — logika murni, tanpa DB.
// Semua aturan uang ada di sini supaya bisa dites tanpa server.

export const AKUN_BIAYA_ADMIN = "5501"; // Beban Administrasi Bank
export const AKUN_MODAL = "3101";       // Modal Pemilik — lawan saldo awal rekening

// Rentang kode akun untuk rekening kas/bank baru. 1101/1102 sudah dipakai,
// 1105 sudah dipakai PPN Masukan — makanya alokasi harus melompati yang terpakai,
// bukan sekadar "kode terakhir + 1".
const KODE_MIN = 1103;
const KODE_MAX = 1199;

export type JurnalBaris = { code: string; debit: number; credit: number };

export type TransferDraft = {
  tanggal: string;
  dariId: string;
  keId: string;
  jumlah: number;
  biayaAdmin: number;
  hariIni: string; // YYYY-MM-DD di zona WIB
};

export function validasiTransfer(d: TransferDraft): string | null {
  if (!d.dariId) return "Rekening sumber wajib dipilih";
  if (!d.keId) return "Rekening tujuan wajib dipilih";
  if (d.dariId === d.keId) return "Rekening sumber dan tujuan tidak boleh sama";
  if (!Number.isFinite(d.jumlah) || d.jumlah <= 0) return "Jumlah transfer harus lebih dari 0";
  if (!Number.isFinite(d.biayaAdmin) || d.biayaAdmin < 0) return "Biaya admin tidak boleh negatif";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.tanggal)) return "Tanggal tidak valid";
  if (d.tanggal > d.hariIni) return "Tanggal tidak boleh di masa depan";
  return null;
}

// Uang keluar dari sumber = jumlah + biaya admin. Biaya ditanggung sumber karena
// itu yang terjadi di rekening koran: bank memotong dari rekening pengirim.
export function jurnalTransfer(
  kodeDari: string, kodeKe: string, jumlah: number, biayaAdmin: number,
): JurnalBaris[] {
  const nilai = Number(jumlah) || 0;
  const biaya = Math.max(0, Number(biayaAdmin) || 0);
  const lines: JurnalBaris[] = [{ code: kodeKe, debit: nilai, credit: 0 }];
  if (biaya > 0) lines.push({ code: AKUN_BIAYA_ADMIN, debit: biaya, credit: 0 });
  lines.push({ code: kodeDari, debit: 0, credit: nilai + biaya });
  return lines;
}

export function jurnalBalik(lines: JurnalBaris[]): JurnalBaris[] {
  return lines.map((l) => ({ code: l.code, debit: l.credit, credit: l.debit }));
}

export function nomorTransfer(tanggal: string, jumlahBulanIni: number): string {
  const [y, m] = tanggal.split("-");
  return `TF.${y}.${m}.${String(jumlahBulanIni + 1).padStart(5, "0")}`;
}

export function kodeAkunBerikutnya(kodeTerpakai: string[]): string | null {
  const dipakai = new Set(kodeTerpakai.map((k) => String(k).trim()));
  for (let n = KODE_MIN; n <= KODE_MAX; n++) {
    const kode = String(n);
    if (!dipakai.has(kode)) return kode;
  }
  return null;
}
