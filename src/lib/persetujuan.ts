// Penyetuju transaksi / approval berjenjang (S6) — logika murni,
// dites di __tests__/persetujuan.test.ts.
//
// Yang dijaga di sini bukan "siapa boleh membuka layar" (itu urusan Akses Grup)
// tapi "berapa nilai yang boleh dilepas tanpa bertanya ke atasan".

export const JENIS_PERSETUJUAN = [
  { jenis: "bayar-faktur", label: "Pembayaran hutang ke pemasok" },
  { jenis: "kas-keluar", label: "Pengeluaran kas / bank" },
] as const;

export type JenisPersetujuan = (typeof JENIS_PERSETUJUAN)[number]["jenis"];

export const PERAN_PENYETUJU = ["OWNER", "ADMIN", "FINANCE"] as const;
export type PeranPenyetuju = (typeof PERAN_PENYETUJU)[number];

export function labelJenis(jenis: string): string {
  return JENIS_PERSETUJUAN.find((j) => j.jenis === jenis)?.label ?? jenis;
}

export type AturanPersetujuan = {
  id: string;
  jenis: string;
  minNilai: number;
  penyetujuRole: PeranPenyetuju;
  aktif: boolean;
};

/**
 * Aturan yang berlaku untuk satu transaksi, atau null kalau tidak perlu izin.
 *
 * Kalau ada beberapa aturan yang sama-sama kena, yang dipakai adalah yang AMBANGNYA
 * PALING TINGGI: itu aturan yang paling spesifik untuk nilai sebesar itu, dan biasanya
 * penyetujunya paling tinggi juga. Memakai ambang terendah membuat aturan "di atas
 * 50 juta harus owner" tidak pernah berlaku begitu ada aturan "di atas 1 juta admin".
 */
export function aturanBerlaku(
  aturan: AturanPersetujuan[],
  jenis: string,
  nilai: number,
): AturanPersetujuan | null {
  const n = Number(nilai) || 0;
  const kena = aturan.filter((a) => a.aktif && a.jenis === jenis && n > a.minNilai);
  if (kena.length === 0) return null;
  return kena.reduce((a, b) => (b.minNilai > a.minNilai ? b : a));
}

export type StatusPengajuan = "menunggu" | "disetujui" | "ditolak" | "terpakai";

export type Keputusan =
  | { boleh: true; alasan: "tanpa aturan" | "sudah disetujui" }
  | { boleh: false; alasan: "menunggu" | "ditolak" | "baru diajukan"; pesan: string };

/**
 * Apa yang harus terjadi pada percobaan transaksi ini, dilihat dari pengajuan
 * yang sudah ada. `pengajuan` = pengajuan hidup untuk dokumen yang sama (kalau ada).
 */
export function putuskan(
  aturan: AturanPersetujuan | null,
  pengajuan: { status: StatusPengajuan; catatan?: string | null } | null,
  namaPeran: string,
): Keputusan {
  if (!aturan) return { boleh: true, alasan: "tanpa aturan" };

  if (pengajuan?.status === "disetujui") return { boleh: true, alasan: "sudah disetujui" };
  if (pengajuan?.status === "menunggu") {
    return {
      boleh: false, alasan: "menunggu",
      pesan: `Transaksi ini sudah diajukan dan masih menunggu persetujuan ${namaPeran}.`,
    };
  }
  if (pengajuan?.status === "ditolak") {
    return {
      boleh: false, alasan: "ditolak",
      pesan: `Persetujuan ditolak${pengajuan.catatan ? `: ${pengajuan.catatan}` : "."}`,
    };
  }
  return {
    boleh: false, alasan: "baru diajukan",
    pesan: `Nilainya di atas batas — sudah diajukan ke ${namaPeran} untuk disetujui.`,
  };
}

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function ringkasAturan(a: AturanPersetujuan): string {
  return `${labelJenis(a.jenis)} di atas ${rp(a.minNilai)} harus disetujui ${a.penyetujuRole}`;
}

/**
 * Kunci pengajuan untuk transaksi yang dokumennya BELUM ada saat izin diminta
 * (kas keluar). Sengaja dibentuk dari isi yang menentukan besarnya pengeluaran —
 * tanggal, rekening, akun lawan, dan nominal — bukan dari keterangannya. Mengubah
 * nominal atau rekening berarti pengeluaran yang berbeda dan izinnya harus diminta
 * ulang; memperbaiki salah ketik keterangan tidak membatalkan izin yang sudah keluar.
 */
export function kunciKasKeluar(o: {
  tanggal: string; accountId: string; lawanCode: string; jumlah: number;
}): string {
  return ["kas", o.tanggal, o.accountId, o.lawanCode, Math.round(Number(o.jumlah) || 0)].join("|");
}
