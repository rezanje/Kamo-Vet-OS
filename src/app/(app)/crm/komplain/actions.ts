"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  FUNGSI_KOMPLAIN, HALAMAN_KOMPLAIN, JENIS_REFERENSI, STATUS, TINGKAT, adalahUuid, hariIniWib, lampiranAman, nominalDariIsian, periksaBaru, periksaStatus,
  type BuatInput, type CatatanInput, type DetailInput, type KategoriInput, type StatusInput,
} from "@/lib/komplain";
import { KomplainError, muatPilihan, panggilTulis, periksaSesiKomplain, type HasilAksi } from "@/lib/komplain-server";

const DITOLAK = { ok: false as const, pesan: "Akun ini tidak boleh memakai Komplain Pelanggan." };
const TIDAK_LENGKAP = { ok: false as const, pesan: "Data tidak lengkap. Muat ulang halaman lalu coba lagi." };
const uuidAtauNull = (x: unknown): string | null => (adalahUuid(x) ? x : null);
const teks = (x: unknown, maks: number): string => (typeof x === "string" ? x.slice(0, maks) : "");
const daftarUuid = (x: unknown): string[] | null => {
  if (!Array.isArray(x)) return [];
  const u = x.filter(adalahUuid);
  return u.length === x.length && u.length <= 10 ? Array.from(new Set(u)) : null;
};

/** Catat komplain baru. Hak (cabang, peran) diperiksa database; ADMIN_ONLINE ditolak di sini dan di database. */
export async function buatKomplainAksi(input: BuatInput): Promise<HasilAksi<{ id: string; nomor: string }>> {
  const i = (input ?? {}) as Partial<BuatInput>;
  const kunci = i.kunci, cabang = i.cabang, kategori = i.kategori;
  const karyawan = daftarUuid(i.karyawan);
  if (!adalahUuid(kunci) || !adalahUuid(cabang) || !adalahUuid(kategori) || karyawan === null) return TIDAK_LENGKAP;
  const supabase = await createClient();
  const sesi = await periksaSesiKomplain(supabase);
  if (!sesi.ok) return DITOLAK;
  const isian = { cabang, kanal: teks(i.kanal, 40), kategori, tingkat: teks(i.tingkat, 20), deskripsi: teks(i.deskripsi, 5000), ref_jenis: teks(i.refJenis, 40), ref_nomor: teks(i.refNomor, 80), tanggal: teks(i.tanggal, 10), nominal: teks(i.nominal, 20) };
  const salah = periksaBaru(isian, hariIniWib());
  if (salah) return { ok: false, pesan: salah };
  const h = await panggilTulis<{ id: string; nomor: string }>(supabase, FUNGSI_KOMPLAIN.buat, {
    p_request_key: kunci, p_branch_id: cabang, p_channel: isian.kanal, p_tanggal: isian.tanggal || null, p_customer_id: uuidAtauNull(i.pelangganId), p_pet_id: uuidAtauNull(i.hewanId),
    p_nama: teks(i.nama, 120).trim() || null, p_telepon: teks(i.telepon, 40).trim() || null, p_ref_jenis: isian.ref_jenis || null, p_ref_nomor: isian.ref_nomor.trim() || null,
    p_category_id: kategori, p_severity: isian.tingkat, p_deskripsi: isian.deskripsi, p_harapan: teks(i.harapan, 1000).trim() || null, p_karyawan: karyawan,
    p_nominal: nominalDariIsian(isian.nominal), p_assigned: uuidAtauNull(i.petugas), p_lampiran: lampiranAman(i.lampiran),
  });
  if (!h.ok) return h;
  revalidatePath(HALAMAN_KOMPLAIN);
  return { ok: true, sudahAda: h.sudahAda, id: String(h.data.id), nomor: String(h.data.nomor) };
}

export async function ubahStatusKomplainAksi(input: StatusInput): Promise<HasilAksi> {
  const i = (input ?? {}) as Partial<StatusInput>;
  if (!adalahUuid(i.kunci) || !adalahUuid(i.id)) return TIDAK_LENGKAP;
  const status = teks(i.status, 40), catatan = teks(i.catatan, 4000), jenis = teks(i.jenis, 40);
  if (!(STATUS as readonly string[]).includes(status)) return { ok: false, pesan: "Pilih status tujuan." };
  const salah = periksaStatus(status, catatan, jenis);
  if (salah) return { ok: false, pesan: salah };
  const supabase = await createClient();
  if (!(await periksaSesiKomplain(supabase)).ok) return DITOLAK;
  const h = await panggilTulis(supabase, FUNGSI_KOMPLAIN.status, { p_id: i.id, p_status: status, p_catatan: catatan.trim() || null, p_resolusi_jenis: jenis || null, p_request_key: i.kunci });
  if (!h.ok) return h;
  revalidatePath(HALAMAN_KOMPLAIN);
  return { ok: true, sudahAda: h.sudahAda };
}

export async function tambahCatatanKomplainAksi(input: CatatanInput): Promise<HasilAksi> {
  const i = (input ?? {}) as Partial<CatatanInput>;
  if (!adalahUuid(i.kunci) || !adalahUuid(i.id)) return TIDAK_LENGKAP;
  const supabase = await createClient();
  if (!(await periksaSesiKomplain(supabase)).ok) return DITOLAK;
  const catatan = teks(i.catatan, 4000).trim();
  const lampiran = lampiranAman(i.lampiran);
  if (catatan.length < 2 && lampiran.length === 0) return { ok: false, pesan: "Tulis catatan atau lampirkan berkas." };
  const h = await panggilTulis(supabase, FUNGSI_KOMPLAIN.catatan, { p_id: i.id, p_catatan: catatan || null, p_lampiran: lampiran, p_request_key: i.kunci });
  if (!h.ok) return h;
  revalidatePath(HALAMAN_KOMPLAIN);
  return { ok: true, sudahAda: h.sudahAda };
}

export async function ubahDetailKomplainAksi(input: DetailInput): Promise<HasilAksi> {
  const i = (input ?? {}) as Partial<DetailInput>;
  const karyawan = daftarUuid(i.karyawan);
  if (!adalahUuid(i.kunci) || !adalahUuid(i.id) || !adalahUuid(i.kategori) || karyawan === null) return TIDAK_LENGKAP;
  const tingkat = teks(i.tingkat, 20), catatan = teks(i.catatan, 4000).trim();
  if (!(TINGKAT as readonly string[]).includes(tingkat)) return { ok: false, pesan: "Pilih tingkat keparahan." };
  if (catatan.length < 3) return { ok: false, pesan: "Tulis alasan perubahan (minimal 3 huruf)." };
  const refJenis = teks(i.refJenis, 40), refNomor = teks(i.refNomor, 80).trim();
  if (Boolean(refJenis) !== Boolean(refNomor) || (refJenis && !(JENIS_REFERENSI as readonly string[]).includes(refJenis))) return { ok: false, pesan: "Isi jenis dan nomor dokumen bersama-sama, atau kosongkan keduanya." };
  const nominal = nominalDariIsian(teks(i.nominal, 20));
  if (teks(i.nominal, 20).trim() && nominal === null) return { ok: false, pesan: "Nilai rupiah harus angka nol atau lebih." };
  const supabase = await createClient();
  if (!(await periksaSesiKomplain(supabase)).ok) return DITOLAK;
  const h = await panggilTulis(supabase, FUNGSI_KOMPLAIN.detail, {
    p_id: i.id, p_category_id: i.kategori, p_severity: tingkat, p_assigned: uuidAtauNull(i.petugas), p_karyawan: karyawan, p_nominal: nominal,
    p_harapan: teks(i.harapan, 1000).trim() || null, p_ref_jenis: refJenis || null, p_ref_nomor: refNomor || null, p_catatan: catatan, p_request_key: i.kunci,
  });
  if (!h.ok) return h;
  revalidatePath(HALAMAN_KOMPLAIN);
  return { ok: true, sudahAda: h.sudahAda };
}

export async function simpanKategoriKomplainAksi(input: KategoriInput): Promise<HasilAksi> {
  const i = (input ?? {}) as Partial<KategoriInput>;
  const nama = teks(i.nama, 80).trim();
  if (nama.length < 2 || nama.length > 60) return { ok: false, pesan: "Nama kategori 2 sampai 60 huruf." };
  if (i.id != null && !adalahUuid(i.id)) return TIDAK_LENGKAP;
  const urut = typeof i.urut === "number" && Number.isInteger(i.urut) && i.urut >= 0 && i.urut <= 9999 ? i.urut : null;
  const supabase = await createClient();
  if (!(await periksaSesiKomplain(supabase)).ok) return DITOLAK;
  const h = await panggilTulis(supabase, FUNGSI_KOMPLAIN.kategoriSimpan, { p_id: i.id ?? null, p_nama: nama, p_urut: urut, p_aktif: i.aktif !== false });
  if (!h.ok) return h;
  revalidatePath(HALAMAN_KOMPLAIN);
  return { ok: true };
}

export async function simpanBatasTelatKomplainAksi(hari: number): Promise<HasilAksi> {
  if (!Number.isInteger(hari) || hari < 1 || hari > 90) return { ok: false, pesan: "Batas terlambat 1 sampai 90 hari." };
  const supabase = await createClient();
  if (!(await periksaSesiKomplain(supabase)).ok) return DITOLAK;
  const h = await panggilTulis(supabase, FUNGSI_KOMPLAIN.pengaturanSimpan, { p_hari_telat: hari });
  if (!h.ok) return h;
  revalidatePath(HALAMAN_KOMPLAIN);
  return { ok: true };
}

/** Petugas yang bisa ditugaskan di satu cabang (formulir komplain). Daftar dibatasi database: akun aktif berakses cabang itu, bukan Admin Online. */
export async function petugasCabangAksi(cabang: string): Promise<{ ok: true; petugas: { id: string; nama: string; peran: string }[] } | { ok: false; pesan: string }> {
  if (!adalahUuid(cabang)) return TIDAK_LENGKAP;
  const supabase = await createClient();
  if (!(await periksaSesiKomplain(supabase)).ok) return DITOLAK;
  try { return { ok: true, petugas: (await muatPilihan(supabase, cabang)).petugas }; }
  catch (e) { return { ok: false, pesan: e instanceof KomplainError ? e.message : "Daftar petugas belum dapat dimuat." }; }
}
