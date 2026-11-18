/**
 * Ubah dokter PJ kunjungan (Andri, 18 Nov 2026: Bubel / Elitha — dokter PJ salah input).
 *
 * Satu tempat untuk aturan layar, pesan, dan ringkasan. Penegak sebenarnya ada di database
 * (migrasi 20261129100000_ubah_dokter_pj.sql): RPC `clinic_change_visit_doctor` memeriksa ulang peran, cabang, alasan,
 * dokter baru, tagihan lunas/payroll, dan kunci permintaan. Layar hanya menyaring pilihan dan menerjemahkan penolakan.
 *
 * Yang berubah: dokter kunjungan (visits), dokter PJ rawat inap, dan baris resep BELUM ditagih yang pelaksananya masih dokter
 * lama (bila dicentang). Tidak berubah: catatan visit dokter (penulis aslinya), tagihan/jurnal/pembayaran yang sudah terbit.
 */
import { clinicalRoles } from "./clinical-staff";

/** Izin Akses Grup (izin khusus, bawaan MATI untuk selain Owner). Harus sama dengan baris katalog di migrasi. */
export const IZIN_UBAH_DOKTER_PJ = "klinik.ubah_dokter_pj";
export const ALASAN_UBAH_DOKTER_MIN = 5;
export const ALASAN_UBAH_DOKTER_MAX = 500;

export const PESAN_UBAH_DOKTER_BELUM_TERKONFIRMASI =
  "Ubah dokter belum terkonfirmasi. Muat ulang halaman dan periksa Dokter PJ sebelum mencoba lagi; tidak ada yang diulang otomatis.";

export type PilihanDokterUbah = { id: string; nama: string; jabatan: string | null };

export type RingkasanUbahDokter = {
  idempotent: boolean;
  dokterLamaNama: string | null;
  dokterBaruNama: string;
  barisDiganti: number;
  barisTetapTertagih: number;
  barisTetapRacikan: number;
  barisTetapLain: number;
  barisTetapTakValid: number;
  tagihanBelumLunasIkut: number;
  tagihanLunasTakBerubah: number;
  tagihanLunasDigeser: number;
};

/** Hasil aksi: selalu dikembalikan (tidak dilempar) — produksi menyamarkan galat lempar menjadi pesan umum. */
export type HasilUbahDokter =
  | ({ ok: true; pesan: string } & RingkasanUbahDokter)
  | { ok: false; kode: string; pesan: string; perluKonfirmasi?: boolean };

export const isPenolakanUbahDokter = (value: unknown): value is Extract<HasilUbahDokter, { ok: false }> =>
  typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;

/** Pembacaan murni: true/false dari database, null = gagal baca. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function bacaBolehUbahDokterPJ(supabase: any): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.rpc("clinic_visit_doctor_change_allowed");
    if (!error) return data === true;
  } catch { /* gagal baca = tidak diketahui */ }
  return null;
}

/** Keputusan untuk layar: jawaban database; bila tak terbaca, Owner tetap boleh (database memutuskan), peran lain tidak. */
export function putuskanBolehUbahDokterPJ(dibaca: boolean | null, role: string | null | undefined): boolean {
  return dibaca === null ? role === "OWNER" : dibaca;
}

/** Alasan yang sah (sama dengan database: 5–500 huruf setelah dirapikan); selain itu null. */
export function alasanUbahDokter(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length >= ALASAN_UBAH_DOKTER_MIN && text.length <= ALASAN_UBAH_DOKTER_MAX ? text : null;
}

/** Panel untuk layar dari bahan yang SUDAH dibaca: tombol tampil hanya bila database menjawab true (gagal baca = tersembunyi). */
export function rakitPanelUbahDokter(
  dibaca: boolean | null, staff: readonly PilihanDokterUbah[], dokterSekarang: string | null | undefined,
): { boleh: boolean; dokter: PilihanDokterUbah[] } {
  return dibaca === true ? { boleh: true, dokter: pilihanDokterBaru(staff, dokterSekarang) } : { boleh: false, dokter: [] };
}

/** Pilihan dokter pengganti: hanya yang berjabatan dokter, bukan dokter yang sekarang, urut nama. Cabang sudah disaring pemuat. */
export function pilihanDokterBaru(staff: readonly PilihanDokterUbah[], dokterSekarang: string | null | undefined): PilihanDokterUbah[] {
  return staff
    .filter((person) => clinicalRoles(person.jabatan).includes("doctor") && person.id !== (dokterSekarang ?? null))
    .slice()
    .sort((a, b) => a.nama.localeCompare(b.nama, "id") || a.id.localeCompare(b.id));
}

const PESAN: Record<string, string> = {
  AUTH: "Sesi masuk berakhir. Masuk lagi lalu coba ulang.",
  DENIED: "Ubah dokter PJ hanya untuk Owner atau peran yang diberi izin \"Ubah dokter PJ\" di Akses Grup.",
  INPUT: "Data permintaan belum lengkap. Muat ulang halaman lalu coba lagi.",
  KUNCI_BEDA: "Permintaan ini sudah dipakai untuk isian lain. Muat ulang halaman lalu coba lagi.",
};

/** Galat RPC -> kalimat. Penolakan database ("UBAH_DOKTER_<KODE>: kalimat") sudah berbahasa biasa; kodenya dibuang dari kalimat. */
export function pesanUbahDokter(raw: string | null | undefined): { kode: string; pesan: string; perluKonfirmasi: boolean } {
  const text = String(raw ?? "").trim();
  const match = /^UBAH_DOKTER_([A-Z_]{3,30}):\s*([\s\S]+)$/.exec(text);
  if (match) {
    const [, kode, kalimat] = match;
    return { kode, pesan: PESAN[kode] && kode !== "DENIED" && kode !== "AUTH" ? PESAN[kode] : kalimat.trim(), perluKonfirmasi: kode === "FINAL" && /Centang/.test(kalimat) };
  }
  if (/lock timeout|55P03|40P01|deadlock/i.test(text)) return { kode: "SIBUK", pesan: "Kunjungan sedang dipakai pengguna lain. Tunggu sebentar lalu coba lagi.", perluKonfirmasi: false };
  if (/permission denied|42501/i.test(text)) return { kode: "DENIED", pesan: PESAN.DENIED, perluKonfirmasi: false };
  return { kode: "TIDAK_TERKONFIRMASI", pesan: PESAN_UBAH_DOKTER_BELUM_TERKONFIRMASI, perluKonfirmasi: false };
}

const angka = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** Jawaban jsonb RPC -> ringkasan bertipe. null bila bentuknya tidak dikenali (jangan menganggap berhasil). */
export function ringkasanDariRpc(data: unknown): RingkasanUbahDokter | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.ok !== true || typeof d.dokter_baru_nama !== "string" || !d.dokter_baru_nama) return null;
  return {
    idempotent: d.idempotent === true,
    dokterLamaNama: typeof d.dokter_lama_nama === "string" ? d.dokter_lama_nama : null,
    dokterBaruNama: d.dokter_baru_nama,
    barisDiganti: angka(d.baris_diganti),
    barisTetapTertagih: angka(d.baris_tetap_tertagih),
    barisTetapRacikan: angka(d.baris_tetap_racikan),
    barisTetapLain: angka(d.baris_tetap_lain),
    barisTetapTakValid: angka(d.baris_tetap_tak_valid),
    tagihanBelumLunasIkut: angka(d.tagihan_belum_lunas_ikut),
    tagihanLunasTakBerubah: angka(d.tagihan_lunas_tak_berubah),
    tagihanLunasDigeser: angka(d.tagihan_lunas_digeser),
  };
}

/** Kalimat hasil untuk staf: apa yang berubah dan apa yang sengaja tidak. */
export function kalimatHasilUbahDokter(r: RingkasanUbahDokter): string {
  const bagian: string[] = [];
  bagian.push(r.idempotent
    ? `Dokter PJ sudah diubah ke ${r.dokterBaruNama} (permintaan yang sama, tidak diulang).`
    : `Dokter PJ diubah${r.dokterLamaNama ? ` dari ${r.dokterLamaNama}` : ""} ke ${r.dokterBaruNama}.`);
  if (r.barisDiganti > 0) bagian.push(`${r.barisDiganti} baris yang belum ditagih ikut pindah ke ${r.dokterBaruNama}.`);
  const tetap = r.barisTetapTertagih + r.barisTetapRacikan + r.barisTetapLain + r.barisTetapTakValid;
  if (tetap > 0) {
    const sebab: string[] = [];
    if (r.barisTetapTertagih) sebab.push(`${r.barisTetapTertagih} sudah tertagih`);
    if (r.barisTetapRacikan) sebab.push(`${r.barisTetapRacikan} racikan`);
    if (r.barisTetapLain) sebab.push(`${r.barisTetapLain} tidak diikutkan/ditarik`);
    if (r.barisTetapTakValid) sebab.push(`${r.barisTetapTakValid} pelaksananya sudah tidak valid`);
    bagian.push(`${tetap} baris tetap dokter lama (${sebab.join(", ")}).`);
  }
  if (r.tagihanBelumLunasIkut > 0) bagian.push(`${r.tagihanBelumLunasIkut} tagihan belum lunas mengikuti dokter baru saat dilunasi.`);
  if (r.tagihanLunasDigeser > 0) bagian.push(`Perhatian: ${r.tagihanLunasDigeser} tagihan lunas berbasis dokter kunjungan ikut pindah (konfirmasi Owner tercatat).`);
  bagian.push("Catatan visit dokter yang sudah ditulis tidak berubah.");
  return bagian.join(" ");
}
