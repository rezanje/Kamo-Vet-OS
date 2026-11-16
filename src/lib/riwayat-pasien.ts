/**
 * Riwayat pasien (satu hewan, semua kunjungan dalam satu halaman). Murni: tanpa akses database.
 *
 * Data dibaca di server (riwayat-pasien-server.ts) lewat jalur yang sama dengan daftar Rekam Medis
 * (RPC `daftar_rekam_medis_halaman` + RLS pemanggil), lalu dirakit di sini. Hanya data klinis:
 * tidak ada harga, tagihan, atau jumlah uang.
 */

type Rel<T> = T | T[] | null | undefined;
const satu = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Kunjungan per muatan. "Muat lebih banyak" menambah satu muatan. */
export const KUNJUNGAN_PER_MUATAN = 60;
/** Batas muatan yang boleh diminta lewat URL (60 x 20 = 1.200 kunjungan; hewan terbanyak saat ini 32). */
export const MAKS_MUATAN = 20;

export const LABEL_RAWAT_INAP = "Rawat inap";
export const LABEL_IMPOR = "Impor";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const adalahUuid = (v: string) => UUID.test(v);

/** Nomor muatan dari URL: bilangan bulat 1..MAKS_MUATAN, selain itu 1. */
export function bacaMuatan(mentah: string | undefined): number {
  const n = Number(mentah);
  return Number.isInteger(n) && n >= 1 && n <= MAKS_MUATAN ? n : 1;
}

// ── Baris sumber (bentuk bacaan database) ──
export type SumberBarisRpc = {
  id: string;
  created_at: string;
  pet_id: string | null;
  branch_id: string | null;
  dokter: string | null;
  keluhan: string | null;
  legacy_source_key: string | null;
  branches?: Rel<{ code: string | null }>;
  medical_records?: Rel<{ diagnosis: string | null; anamnesis: string | null }>;
};
export type SumberKunjungan = {
  id: string;
  poli: string | null;
  status: string | null;
  archived_at: string | null;
  branches?: Rel<{ code: string | null; name: string | null }>;
};
export type SumberRekam = {
  id: string;
  visit_id: string;
  created_at: string | null;
  diagnosis: string | null;
  anamnesis: string | null;
  therapy: string | null;
  gejala_klinis: string | null;
  hasil_penunjang: string | null;
  follow_up: string | null;
  catatan_resep: string | null;
  suhu: number | string | null;
  berat: number | string | null;
};
export type SumberItem = {
  id: string;
  medical_record_id: string;
  nama_obat: string | null;
  qty: number | string | null;
  satuan: string | null;
  aturan_pakai: string | null;
  jenis: string | null;
};
export type SumberRawatInap = {
  id: string;
  visit_id: string;
  condition_status: string | null;
  admitted_at: string | null;
  discharged_at: string | null;
  created_at?: string | null;
};

// ── Hasil rakitan ──
export type BarisObat = { id: string; nama: string; jumlah: string; aturan: string | null };
export type KunjunganRiwayat = {
  visitId: string;
  tanggal: string;
  cabang: string | null;
  /** branch_id kunjungan (null = riwayat impor tanpa cabang). Dipakai agar tombol Buka hanya untuk cabang aktif. */
  cabangId?: string | null;
  impor: boolean;
  diarsipkan: boolean;
  dokter: string | null;
  poli: string | null;
  keluhan: string | null;
  adaRekam: boolean;
  suhu: number | null;
  berat: number | null;
  anamnesa: string | null;
  gejala: string | null;
  penunjang: string | null;
  diagnosa: string | null;
  terapi: string | null;
  catatanResep: string | null;
  tindakLanjut: string | null;
  obat: BarisObat[];
  tindakan: BarisObat[];
  rawatInap: { id: string; aktif: boolean } | null;
};

const teks = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
function angka(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
const waktu = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Jumlah tanpa nol di belakang koma: 2 -> "2", 1.5 -> "1,5". */
export function jumlahObat(qty: number | string | null, satuan: string | null): string {
  const n = angka(qty);
  const s = teks(satuan);
  if (n == null) return s ?? "";
  return `${n.toLocaleString("id-ID", { maximumFractionDigits: 3 })}${s ? ` ${s}` : ""}`;
}

function barisObat(item: SumberItem): BarisObat {
  return { id: item.id, nama: teks(item.nama_obat) ?? "—", jumlah: jumlahObat(item.qty, item.satuan), aturan: teks(item.aturan_pakai) };
}

/** Jasa/tindakan = jenis "jasa"; selain itu obat/barang. */
const adalahTindakan = (jenis: string | null) => (jenis ?? "").trim().toLowerCase() === "jasa";

/**
 * Merakit kunjungan terbaru dulu. `rpc` menentukan urutan dan himpunan kunjungan (sudah disaring RLS + cabang aktif
 * oleh database); bacaan lain hanya melengkapi baris yang sudah ada di himpunan itu. Satu kunjungan boleh punya
 * beberapa rekam medis: yang dipakai yang terbaru (sama dengan halaman detail).
 */
export function susunKunjungan(input: {
  rpc: SumberBarisRpc[];
  kunjungan: SumberKunjungan[];
  rekam: SumberRekam[];
  item: SumberItem[];
  rawatInap: SumberRawatInap[];
}): KunjunganRiwayat[] {
  const kunjunganById = new Map(input.kunjungan.map((v) => [v.id, v]));
  const rekamTerbaru = new Map<string, SumberRekam>();
  for (const r of input.rekam) {
    const lama = rekamTerbaru.get(r.visit_id);
    if (!lama || waktu(r.created_at) > waktu(lama.created_at) || (waktu(r.created_at) === waktu(lama.created_at) && r.id > lama.id)) rekamTerbaru.set(r.visit_id, r);
  }
  const itemPerRekam = new Map<string, SumberItem[]>();
  for (const it of input.item) itemPerRekam.set(it.medical_record_id, [...(itemPerRekam.get(it.medical_record_id) ?? []), it]);
  const ranapPerKunjungan = new Map<string, SumberRawatInap>();
  for (const ri of input.rawatInap) {
    const lama = ranapPerKunjungan.get(ri.visit_id);
    if (!lama || waktu(ri.created_at ?? ri.admitted_at) > waktu(lama.created_at ?? lama.admitted_at)) ranapPerKunjungan.set(ri.visit_id, ri);
  }

  const hasil = input.rpc.map((row): KunjunganRiwayat => {
    const extra = kunjunganById.get(row.id);
    const rekam = rekamTerbaru.get(row.id) ?? null;
    const ringkas = satu(row.medical_records);
    const cabangRel = satu(extra?.branches) ?? satu(row.branches);
    const cabang = teks((cabangRel as { name?: string | null } | null)?.name) ?? teks(cabangRel?.code);
    const baris = rekam ? (itemPerRekam.get(rekam.id) ?? []) : [];
    const ranap = ranapPerKunjungan.get(row.id) ?? null;
    return {
      visitId: row.id,
      tanggal: row.created_at,
      cabang,
      cabangId: row.branch_id,
      impor: Boolean(row.legacy_source_key),
      diarsipkan: Boolean(extra?.archived_at),
      dokter: teks(row.dokter),
      poli: teks(extra?.poli),
      keluhan: teks(row.keluhan),
      adaRekam: Boolean(rekam),
      suhu: angka(rekam?.suhu),
      berat: angka(rekam?.berat),
      anamnesa: teks(rekam?.anamnesis) ?? teks(ringkas?.anamnesis),
      gejala: teks(rekam?.gejala_klinis),
      penunjang: teks(rekam?.hasil_penunjang),
      diagnosa: teks(rekam?.diagnosis) ?? teks(ringkas?.diagnosis),
      terapi: teks(rekam?.therapy),
      catatanResep: teks(rekam?.catatan_resep),
      tindakLanjut: teks(rekam?.follow_up),
      obat: baris.filter((b) => !adalahTindakan(b.jenis)).map(barisObat),
      tindakan: baris.filter((b) => adalahTindakan(b.jenis)).map(barisObat),
      rawatInap: ranap ? { id: ranap.id, aktif: ranap.discharged_at == null } : null,
    };
  });
  // Terbaru dulu; urutan RPC sudah begitu, ini hanya menjaga bila sumbernya berubah.
  return hasil.sort((a, b) => waktu(b.tanggal) - waktu(a.tanggal) || (a.visitId < b.visitId ? -1 : 1));
}

// ── Berat badan per kunjungan ──
export type TitikBerat = { visitId: string; tanggal: string; berat: number | null };

/** Dari yang terlama ke terbaru; kunjungan tanpa catatan berat tetap ada dengan berat null. */
export function deretBerat(kunjungan: KunjunganRiwayat[]): TitikBerat[] {
  return kunjungan
    .map((k) => ({ visitId: k.visitId, tanggal: k.tanggal, berat: k.berat != null && k.berat > 0 ? k.berat : null }))
    .sort((a, b) => waktu(a.tanggal) - waktu(b.tanggal));
}

/** Titik grafik mini (SVG) dari titik berat yang terisi; null bila kurang dari 2 titik. */
export function titikGrafik(deret: TitikBerat[], lebar = 160, tinggi = 36, pad = 4): string | null {
  const isi = deret.filter((t): t is TitikBerat & { berat: number } => t.berat != null);
  if (isi.length < 2) return null;
  const nilai = isi.map((t) => t.berat);
  const min = Math.min(...nilai), max = Math.max(...nilai);
  const rentang = max - min || 1;
  return isi.map((t, i) => {
    const x = pad + (i / (isi.length - 1)) * (lebar - pad * 2);
    const y = max === min ? tinggi / 2 : pad + (1 - (t.berat - min) / rentang) * (tinggi - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

// ── Profil hewan ──
export function umurHewan(dob: string | null | undefined, sekarang: Date = new Date()): string | null {
  if (!dob) return null;
  const lahir = new Date(dob);
  if (Number.isNaN(lahir.getTime()) || lahir.getTime() > sekarang.getTime()) return null;
  let bulan = (sekarang.getUTCFullYear() - lahir.getUTCFullYear()) * 12 + (sekarang.getUTCMonth() - lahir.getUTCMonth());
  if (sekarang.getUTCDate() < lahir.getUTCDate()) bulan -= 1;
  if (bulan < 0) return null;
  const tahun = Math.floor(bulan / 12), sisa = bulan % 12;
  if (tahun === 0) return sisa === 0 ? "kurang dari 1 bulan" : `${sisa} bln`;
  return sisa === 0 ? `${tahun} th` : `${tahun} th ${sisa} bln`;
}

export type ProfilPasien = {
  id: string;
  nama: string;
  spesies: string | null;
  ras: string | null;
  kelamin: string | null;
  umur: string | null;
  beratTerkini: number | null;
  alergi: string | null;
  steril: string | null;
  kondisiKhusus: string | null;
  golonganDarah: string | null;
  microchip: string | null;
  pemilik: string;
  telepon: string;
  hewanLain: { id: string; nama: string; spesies: string | null }[];
};

export type SumberHewan = {
  id: string;
  name: string | null;
  species: string | null;
  breed: string | null;
  dob: string | null;
  gender: string | null;
  weight: number | string | null;
  alergi: string | null;
  sterilisasi: string | null;
  kondisi_khusus: string | null;
  golongan_darah: string | null;
  microchip: string | null;
  customers?: Rel<{ name: string | null; phone: string | null }>;
};

export function susunProfil(
  hewan: SumberHewan,
  lain: { id: string; name: string | null; species: string | null }[],
  pemilikTidakSah: (nama: string | null | undefined) => boolean,
  sekarang: Date = new Date(),
): ProfilPasien {
  const pemilik = satu(hewan.customers);
  const tidakSah = pemilikTidakSah(pemilik?.name);
  return {
    id: hewan.id,
    nama: teks(hewan.name) ?? "—",
    spesies: teks(hewan.species),
    ras: teks(hewan.breed),
    kelamin: teks(hewan.gender),
    umur: umurHewan(hewan.dob, sekarang),
    beratTerkini: angka(hewan.weight) && angka(hewan.weight)! > 0 ? angka(hewan.weight) : null,
    alergi: teks(hewan.alergi),
    steril: teks(hewan.sterilisasi),
    kondisiKhusus: teks(hewan.kondisi_khusus),
    golonganDarah: teks(hewan.golongan_darah),
    microchip: teks(hewan.microchip),
    pemilik: tidakSah ? "Pemilik perlu verifikasi" : teks(pemilik?.name) ?? "—",
    telepon: tidakSah ? "" : teks(pemilik?.phone) ?? "",
    hewanLain: lain.filter((p) => p.id !== hewan.id).map((p) => ({ id: p.id, nama: teks(p.name) ?? "—", spesies: teks(p.species) })),
  };
}
