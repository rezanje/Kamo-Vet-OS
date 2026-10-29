// Aliran impor rekam medis: folder dibaca sepotong demi sepotong, tidak pernah sekaligus.
//
// Semua di berkas ini murni (tanpa DOM, tanpa jaringan) supaya bisa diuji langsung dan
// dipakai ulang oleh sumber berkas apa pun -- folder lokal hari ini, Google Drive nanti.

import { reportCsv } from "./csv-report";
import type { BerkasImporRekamMedis, FolderImporRekamMedis } from "./impor-rekam-medis-sumber";
import type { RekamMedisImporHeld, RekamMedisImporRow } from "./impor-rekam-medis";

export type BatasPotonganImpor = { berkas: number; bytes: number };

/** Satu potongan harus muat jauh di bawah batas badan permintaan (32 MB) dan batas waktu fungsi. */
export const BATAS_POTONGAN_AWAL: BatasPotonganImpor = { berkas: 25, bytes: 8 * 1024 * 1024 };
export const BATAS_POTONGAN_MINIMUM: BatasPotonganImpor = { berkas: 1, bytes: 1024 * 1024 };
/** Batas baris per panggilan simpan massal. Fungsi database menolak di atas 500. */
export const MAKS_BARIS_PER_KIRIMAN = 150;
/** Batas baris yang diterima satu permintaan potongan di server. */
export const MAKS_BARIS_POTONGAN_REKAM_MEDIS = 200;
const POTONGAN_LAMBAT_MS = 18_000;
const POTONGAN_CEPAT_MS = 6_000;

export type PotonganImporRekamMedis = {
  urutan: number;
  folderId: string;
  folderNama: string;
  berkas: BerkasImporRekamMedis[];
  bytes: number;
  /** Potongan terakhir dari foldernya; titik aman untuk menyimpan kemajuan. */
  akhirFolder: boolean;
};

/**
 * Potongan tidak pernah mencampur dua folder pemilik: kartu satu pemilik perlu dibaca
 * bersama supaya alamat/spesies yang kosong bisa dilengkapi dari kartu lain miliknya,
 * dan kemajuan disimpan per folder.
 */
export function rencanakanPotonganImpor(
  folders: readonly FolderImporRekamMedis[],
  batas: BatasPotonganImpor = BATAS_POTONGAN_AWAL,
): PotonganImporRekamMedis[] {
  if (!Number.isFinite(batas.berkas) || batas.berkas < 1) throw new Error("Batas berkas per potongan harus minimal 1.");
  if (!Number.isFinite(batas.bytes) || batas.bytes <= 0) throw new Error("Batas ukuran per potongan harus lebih dari 0.");
  const potongan: PotonganImporRekamMedis[] = [];
  for (const folder of folders) {
    const awal = potongan.length;
    let berkas: BerkasImporRekamMedis[] = [];
    let bytes = 0;
    const tutup = () => {
      if (!berkas.length) return;
      potongan.push({ urutan: potongan.length, folderId: folder.id, folderNama: folder.nama, berkas, bytes, akhirFolder: false });
      berkas = [];
      bytes = 0;
    };
    for (const item of folder.berkas) {
      const ukuran = Number.isFinite(item.ukuran) && item.ukuran > 0 ? item.ukuran : 0;
      if (berkas.length && (berkas.length >= batas.berkas || bytes + ukuran > batas.bytes)) tutup();
      berkas.push(item);
      bytes += ukuran;
    }
    tutup();
    if (potongan.length > awal) potongan[potongan.length - 1].akhirFolder = true;
  }
  return potongan.map((item, urutan) => ({ ...item, urutan }));
}

/** Perkecil saat lambat atau gagal, perbesar pelan-pelan saat lancar. Tidak pernah melewati batas awal. */
export function sesuaikanBatasPotongan(
  batas: BatasPotonganImpor,
  hasil: { durasiMs?: number; gagal?: boolean },
  awal: BatasPotonganImpor = BATAS_POTONGAN_AWAL,
): BatasPotonganImpor {
  const kecilkan = (faktor: number): BatasPotonganImpor => ({
    berkas: Math.max(BATAS_POTONGAN_MINIMUM.berkas, Math.floor(batas.berkas * faktor)),
    bytes: Math.max(BATAS_POTONGAN_MINIMUM.bytes, Math.floor(batas.bytes * faktor)),
  });
  if (hasil.gagal) return kecilkan(0.5);
  if (typeof hasil.durasiMs === "number" && hasil.durasiMs > POTONGAN_LAMBAT_MS) return kecilkan(0.6);
  if (typeof hasil.durasiMs === "number" && hasil.durasiMs < POTONGAN_CEPAT_MS) {
    return {
      berkas: Math.min(awal.berkas, Math.max(batas.berkas + 1, Math.ceil(batas.berkas * 1.5))),
      bytes: Math.min(awal.bytes, Math.ceil(batas.bytes * 1.5)),
    };
  }
  return batas;
}

export function bagiKirimanBaris<T>(rows: readonly T[], maks: number = MAKS_BARIS_PER_KIRIMAN): T[][] {
  if (!Number.isInteger(maks) || maks < 1) throw new Error("Batas baris per kiriman harus minimal 1.");
  const kiriman: T[][] = [];
  for (let index = 0; index < rows.length; index += maks) kiriman.push(rows.slice(index, index + maks));
  return kiriman;
}

// ---------------------------------------------------------------------------
// Pelacak ganda lintas potongan
// ---------------------------------------------------------------------------

const rapikan = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("id-ID").replace(/[.:]/g, "").replace(/\s+/g, " ");

export function kunciGandaRiwayat(row: Pick<RekamMedisImporRow, "owner_name" | "phone" | "patient_name" | "record_date">) {
  return [rapikan(row.owner_name), String(row.phone ?? "").replace(/\D/g, ""), rapikan(row.patient_name), row.record_date ?? ""].join("::");
}

/** Sidik pendek: menahan 20.000 baris di memori tanpa menyimpan isi medisnya. */
export function sidikRiwayat(row: RekamMedisImporRow) {
  const teks = JSON.stringify([
    row.record_no, row.owner_name, row.phone, row.patient_name, row.record_date,
    row.species, row.breed, row.gender, row.dob, row.doctor,
    row.note, row.anamnesis, row.clinical_findings, row.diagnosis, row.therapy,
  ]);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < teks.length; index += 1) {
    const kode = teks.charCodeAt(index);
    a = Math.imul(a ^ kode, 0x01000193) >>> 0;
    b = Math.imul(b + kode, 0x85ebca6b) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}${teks.length.toString(36)}`;
}

export type PutusanGandaRiwayat = "baru" | "salinan" | "bentrok";

/** Menjaga penilaian ganda tetap sama seperti saat seluruh folder dibaca sekaligus. */
export class PelacakGandaRiwayat {
  private readonly terlihat = new Map<string, string>();

  periksa(row: RekamMedisImporRow): PutusanGandaRiwayat {
    const kunci = kunciGandaRiwayat(row);
    const sidik = sidikRiwayat(row);
    const sebelumnya = this.terlihat.get(kunci);
    if (sebelumnya === sidik) return "salinan";
    if (sebelumnya !== undefined) return "bentrok";
    this.terlihat.set(kunci, sidik);
    return "baru";
  }

  get jumlah() {
    return this.terlihat.size;
  }
}

export const ALASAN_GANDA_RIWAYAT = "Kemungkinan riwayat ganda: pemilik, pasien, dan tanggal sama";

/** Pisahkan baris potongan menjadi yang dikirim dan yang ditahan karena ganda. */
export function saringGandaPotongan(rows: readonly RekamMedisImporRow[], pelacak: PelacakGandaRiwayat) {
  const siap: RekamMedisImporRow[] = [];
  const ditahan: RekamMedisImporHeld[] = [];
  let salinan = 0;
  for (const row of rows) {
    const putusan = pelacak.periksa(row);
    if (putusan === "salinan") salinan += 1;
    else if (putusan === "bentrok") ditahan.push({ source_key: row.source_key, source_file: row.source_file, source_sheet: row.source_sheet, reason: ALASAN_GANDA_RIWAYAT });
    else siap.push(row);
  }
  return { siap, ditahan, salinan };
}

// ---------------------------------------------------------------------------
// Titik simpan -- melanjutkan setelah tab tertutup atau komputer mati
// ---------------------------------------------------------------------------

export type PenyimpanTitikSimpan = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const AWALAN_TITIK_SIMPAN = "kamo.impor-rekam-medis.v1:";

/** Tanda ruang: pilihan folder yang sama menghasilkan tanda yang sama, beda pilihan beda tanda. */
export function tandaRuangImpor(akar: string, folders: readonly FolderImporRekamMedis[]) {
  const berkas = folders.reduce((jumlah, folder) => jumlah + folder.berkas.length, 0);
  const bytes = folders.reduce((jumlah, folder) => jumlah + folder.ukuran, 0);
  return `${akar}|${folders.length}|${berkas}|${bytes}`;
}

export function kunciTitikSimpan(ruang: string) {
  return `${AWALAN_TITIK_SIMPAN}${ruang}`;
}

export function bacaTitikSimpan(penyimpan: PenyimpanTitikSimpan | null | undefined, ruang: string): string[] {
  if (!penyimpan) return [];
  try {
    const mentah = penyimpan.getItem(kunciTitikSimpan(ruang));
    if (!mentah) return [];
    const isi: unknown = JSON.parse(mentah);
    if (!isi || typeof isi !== "object" || !Array.isArray((isi as { folderSelesai?: unknown }).folderSelesai)) return [];
    return (isi as { folderSelesai: unknown[] }).folderSelesai.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function tulisTitikSimpan(penyimpan: PenyimpanTitikSimpan | null | undefined, ruang: string, folderSelesai: readonly string[]) {
  if (!penyimpan) return;
  try {
    penyimpan.setItem(kunciTitikSimpan(ruang), JSON.stringify({ folderSelesai: [...folderSelesai], diperbarui: new Date().toISOString() }));
  } catch {
    // Kuota penyimpanan penuh bukan alasan menghentikan impor; lanjut tanpa titik simpan.
  }
}

export function hapusTitikSimpan(penyimpan: PenyimpanTitikSimpan | null | undefined, ruang: string) {
  if (!penyimpan) return;
  try {
    penyimpan.removeItem(kunciTitikSimpan(ruang));
  } catch {
    // Diabaikan: titik simpan hanya mempercepat, bukan sumber kebenaran.
  }
}

/** Folder yang sudah tercatat selesai dilewati tanpa dibaca; sisanya tetap dicek ke database. */
export function sisakanFolderBelumSelesai(folders: readonly FolderImporRekamMedis[], selesai: readonly string[]) {
  const sudah = new Set(selesai);
  return folders.filter((folder) => !sudah.has(folder.id));
}

// ---------------------------------------------------------------------------
// Kemajuan yang terbaca manusia
// ---------------------------------------------------------------------------

export type HitunganImporRekamMedis = {
  tersimpan: number;
  sudahAda: number;
  ditahan: number;
  perluKeputusan: number;
  dilewati: number;
};

export const HITUNGAN_IMPOR_KOSONG: HitunganImporRekamMedis = { tersimpan: 0, sudahAda: 0, ditahan: 0, perluKeputusan: 0, dilewati: 0 };

export function perkiraanSisaWaktuImpor(terpakaiMs: number, selesai: number, total: number): number | null {
  if (!Number.isFinite(terpakaiMs) || terpakaiMs <= 0) return null;
  if (!Number.isFinite(selesai) || selesai <= 0 || !Number.isFinite(total) || total <= selesai) return null;
  return Math.round((terpakaiMs / selesai) * (total - selesai));
}

export function labelSisaWaktuImpor(sisaMs: number | null) {
  if (sisaMs === null) return "menghitung…";
  const detik = Math.max(1, Math.round(sisaMs / 1000));
  if (detik < 90) return `±${detik} detik lagi`;
  const menit = Math.round(detik / 60);
  if (menit < 90) return `±${menit} menit lagi`;
  const jam = Math.floor(menit / 60);
  const sisaMenit = menit % 60;
  return sisaMenit ? `±${jam} jam ${sisaMenit} menit lagi` : `±${jam} jam lagi`;
}

export type StatusAliranImpor = "siap" | "berjalan" | "jeda" | "selesai" | "gagal";

export function teksProgresImpor(
  status: StatusAliranImpor,
  folder: { selesai: number; total: number },
  hitungan: HitunganImporRekamMedis,
  sisaMs: number | null,
) {
  const bagian = [
    `${folder.selesai} dari ${folder.total} folder`,
    `${hitungan.tersimpan} tersimpan`,
    `${hitungan.sudahAda} sudah ada`,
    `${hitungan.ditahan} ditahan`,
    `${hitungan.perluKeputusan} perlu keputusan`,
  ];
  if (status === "berjalan") bagian.push(labelSisaWaktuImpor(sisaMs));
  if (status === "jeda") bagian.push("dijeda");
  if (status === "selesai") bagian.push("selesai");
  if (status === "gagal") bagian.push("berhenti karena gangguan");
  return bagian.join(" · ");
}

export function labelTombolAliran(status: StatusAliranImpor) {
  if (status === "berjalan") return "Jeda";
  if (status === "jeda") return "Lanjutkan";
  if (status === "gagal") return "Coba lagi";
  return "Mulai impor";
}

// ---------------------------------------------------------------------------
// Kirim ulang saat jaringan goyang -- aman karena simpan massal kebal pengulangan
// ---------------------------------------------------------------------------

const POLA_GANGGUAN_SEMENTARA = /failed to fetch|network|unexpected response|timeout|timed out|socket|econnreset|fetch failed|502|503|504|gateway|statement timeout|57014/i;

export function gangguanBolehDiulang(cause: unknown) {
  const pesan = cause instanceof Error ? cause.message : String(cause ?? "");
  return POLA_GANGGUAN_SEMENTARA.test(pesan);
}

export async function kirimDenganUlangan<T>(
  kerja: (percobaan: number) => Promise<T>,
  opsi: { maksPercobaan?: number; jedaAwalMs?: number; tidur?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const maks = opsi.maksPercobaan ?? 4;
  const jedaAwal = opsi.jedaAwalMs ?? 800;
  const tidur = opsi.tidur ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let terakhir: unknown;
  for (let percobaan = 1; percobaan <= maks; percobaan += 1) {
    try {
      return await kerja(percobaan);
    } catch (cause) {
      terakhir = cause;
      if (percobaan >= maks || !gangguanBolehDiulang(cause)) throw cause;
      await tidur(jedaAwal * 2 ** (percobaan - 1));
    }
  }
  throw terakhir instanceof Error ? terakhir : new Error("Pengiriman gagal.");
}

// ---------------------------------------------------------------------------
// Catatan riwayat yang ditahan -- diunduh pengguna, tidak disimpan di server
// ---------------------------------------------------------------------------

export function csvRiwayatDitahan(rows: readonly RekamMedisImporHeld[]) {
  return reportCsv(
    ["File", "Sheet", "Jejak sumber", "Alasan ditahan"],
    rows.map((row) => [row.source_file, row.source_sheet, row.source_key, row.reason]),
  );
}

export function namaBerkasCatatanDitahan(sekarang: Date) {
  return `riwayat-ditahan-${sekarang.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
}

// ---------------------------------------------------------------------------
// Pengukuran -- berapa perjalanan bolak-balik yang dibutuhkan folder sebesar ini
// ---------------------------------------------------------------------------

export type UkuranRencanaImpor = {
  folder: number;
  berkas: number;
  bytes: number;
  baris: number;
  potongan: number;
  permintaanBrowser: number;
  panggilanSimpanMassal: number;
  panggilanDatabase: number;
  /** Pembanding: alur lama -- satu permintaan per berkas, lalu satu RPC per baris. */
  permintaanBrowserLama: number;
  panggilanDatabaseLama: number;
};

export function ukurRencanaImpor(
  folders: readonly FolderImporRekamMedis[],
  pilihan: { batas?: BatasPotonganImpor; barisPerBerkas?: number; maksBarisPerKiriman?: number } = {},
): UkuranRencanaImpor {
  const batas = pilihan.batas ?? BATAS_POTONGAN_AWAL;
  const barisPerBerkas = pilihan.barisPerBerkas ?? 1;
  const maksBaris = pilihan.maksBarisPerKiriman ?? MAKS_BARIS_PER_KIRIMAN;
  const potongan = rencanakanPotonganImpor(folders, batas);
  const berkas = folders.reduce((jumlah, folder) => jumlah + folder.berkas.length, 0);
  const bytes = folders.reduce((jumlah, folder) => jumlah + folder.ukuran, 0);
  const baris = berkas * barisPerBerkas;
  // Per potongan: satu pemindaian identitas + sejumlah panggilan simpan massal.
  const panggilanSimpanMassal = potongan.reduce((jumlah, item) => jumlah + Math.max(1, Math.ceil((item.berkas.length * barisPerBerkas) / maksBaris)), 0);
  return {
    folder: folders.length,
    berkas,
    bytes,
    baris,
    potongan: potongan.length,
    permintaanBrowser: potongan.length,
    panggilanSimpanMassal,
    panggilanDatabase: potongan.length + panggilanSimpanMassal,
    permintaanBrowserLama: berkas + Math.ceil(baris / 50),
    panggilanDatabaseLama: berkas + baris,
  };
}
