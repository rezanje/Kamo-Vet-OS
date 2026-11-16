import { createClientLintasCabang } from "@/lib/supabase/server";
import { ListLoadError, readCompleteList } from "@/lib/checked-list";
import { bacaHasilHalamanRekamMedis } from "@/lib/daftar-rekam-medis";
import { isPlaceholderOwnerName } from "@/lib/impor-rekam-medis";
import {
  KUNJUNGAN_PER_MUATAN, susunKunjungan, susunProfil,
  type KunjunganRiwayat, type ProfilPasien, type SumberBarisRpc, type SumberHewan, type SumberItem, type SumberKunjungan,
  type SumberRawatInap, type SumberRekam,
} from "@/lib/riwayat-pasien";

const GAGAL = "Riwayat pasien belum dapat dimuat lengkap. Coba muat ulang.";
const gagal = () => new ListLoadError(GAGAL);
const PECAH = 200;

export type RiwayatPasien =
  | { status: "ada"; profil: ProfilPasien; kunjungan: KunjunganRiwayat[]; total: number; adaLagi: boolean; muatan: number; cabangAktif: string | null }
  | { status: "tidak-ada" };

/**
 * Riwayat SATU hewan: semua kunjungan yang punya rekam medis, terbaru dulu.
 *
 * Akses = RLS pemanggil: klien tanpa header cabang, RPC `daftar_rekam_medis_halaman` TANPA p_cabang, jadi semua cabang
 * yang boleh dibaca pengguna ini (user_can_access_branch + izin riwayat impor) ikut tampil, bukan hanya cabang aktif;
 * pengguna yang hanya punya akses cabang A tidak pernah melihat cabang B (RLS, bukan filter aplikasi). Sama dengan
 * jumlah di kartu Per pasien (rekam-medis-semua-cabang-server.ts). Bacaan lanjutan hanya untuk ID kunjungan yang
 * dikembalikan RPC itu, digabung per kelompok (bukan satu bacaan per kunjungan). Tidak membaca invoice/harga.
 * Galat apa pun = ListLoadError (tidak pernah dianggap kosong).
 */
export async function bacaRiwayatPasien(petId: string, muatan: number): Promise<RiwayatPasien> {
  const { client, cabangAktif } = await createClientLintasCabang();

  const halaman = async (nomor: number) => {
    const diminta = { batas: KUNJUNGAN_PER_MUATAN, offset: nomor * KUNJUNGAN_PER_MUATAN };
    const result = await client.rpc("daftar_rekam_medis_halaman", {
      p_cabang: null, p_cari: null, p_tampilan: "semua", p_pet: petId, p_batas: diminta.batas, p_offset: diminta.offset,
    });
    return bacaHasilHalamanRekamMedis<SumberBarisRpc>(result, diminta, (pesan) => new ListLoadError(pesan));
  };

  // Tahap 1: profil hewan + halaman kunjungan (paralel). Muatan n = n halaman pertama.
  let hewanRes, halamanRes;
  try {
    [hewanRes, halamanRes] = await Promise.all([
      client.from("pets")
        .select("id, name, species, breed, dob, gender, weight, alergi, sterilisasi, kondisi_khusus, golongan_darah, microchip, customer_id, customers(name, phone)")
        .eq("id", petId).maybeSingle(),
      Promise.all(Array.from({ length: muatan }, (_, i) => halaman(i))),
    ]);
  } catch (error) {
    if (error instanceof ListLoadError) throw error;
    throw gagal();
  }
  if (hewanRes.error) throw gagal();
  const hewan = hewanRes.data as (SumberHewan & { customer_id: string | null }) | null;
  const total = halamanRes[0].jumlah;
  const rpc = halamanRes.flatMap((h) => h.baris);
  if (!hewan) {
    // Tidak terlihat oleh pengguna ini (RLS) atau tidak ada. Bila RPC sempat mengembalikan baris = data tak konsisten.
    if (rpc.length) throw gagal();
    return { status: "tidak-ada" };
  }
  const ids = new Set<string>();
  for (const row of rpc) {
    if (row.pet_id !== petId || ids.has(row.id)) throw gagal(); // satu hewan saja, tanpa duplikat
    ids.add(row.id);
  }
  const idKunjungan = [...ids];

  // Tahap 2: semua yang hanya butuh ID kunjungan / pemilik, per kelompok ID.
  const perKelompok = <T,>(daftar: string[], baca: (kelompok: string[]) => Promise<T[]>) => Promise.all(
    Array.from({ length: Math.ceil(daftar.length / PECAH) }, (_, i) => baca(daftar.slice(i * PECAH, (i + 1) * PECAH))),
  ).then((x) => x.flat());
  let kunjungan: SumberKunjungan[], rekam: SumberRekam[], rawatInap: SumberRawatInap[], lain: { id: string; name: string | null; species: string | null }[];
  try {
    [kunjungan, rekam, rawatInap, lain] = await Promise.all([
      perKelompok(idKunjungan, (k) => readCompleteList<SumberKunjungan>((from, to) => client.from("visits")
        .select("id, poli, status, archived_at, branches(code, name)", { count: "exact" }).in("id", k).order("id").range(from, to), "Riwayat pasien")),
      perKelompok(idKunjungan, (k) => readCompleteList<SumberRekam>((from, to) => client.from("medical_records")
        .select("id, visit_id, created_at, diagnosis, anamnesis, therapy, gejala_klinis, hasil_penunjang, follow_up, catatan_resep, suhu, berat", { count: "exact" })
        .in("visit_id", k).order("created_at", { ascending: false }).order("id").range(from, to), "Riwayat pasien")),
      perKelompok(idKunjungan, (k) => readCompleteList<SumberRawatInap>((from, to) => client.from("inpatient_records")
        .select("id, visit_id, condition_status, admitted_at, discharged_at, created_at", { count: "exact" })
        .in("visit_id", k).order("created_at", { ascending: false }).order("id").range(from, to), "Riwayat pasien")),
      hewan.customer_id
        ? readCompleteList<{ id: string; name: string | null; species: string | null }>((from, to) => client.from("pets")
          .select("id, name, species", { count: "exact" }).eq("customer_id", hewan.customer_id!).neq("id", petId).order("name").order("id").range(from, to), "Hewan pemilik")
        : Promise.resolve([]),
    ]);
  } catch (error) {
    if (error instanceof ListLoadError) throw error;
    throw gagal();
  }
  if (rekam.some((r) => !ids.has(r.visit_id)) || kunjungan.some((v) => !ids.has(v.id)) || rawatInap.some((r) => !ids.has(r.visit_id))) throw gagal();

  // Tahap 3: resep/tindakan per rekam medis (butuh ID rekam medis). Baris yang ditarik tidak ikut (sama dengan detail).
  const idRekam = [...new Set(rekam.map((r) => r.id))];
  let item: SumberItem[];
  try {
    item = await perKelompok(idRekam, (k) => readCompleteList<SumberItem>((from, to) => client.from("prescription_items")
      .select("id, medical_record_id, nama_obat, qty, satuan, aturan_pakai, jenis", { count: "exact" })
      .in("medical_record_id", k).is("record_withdrawn_at", null).order("created_at").order("id").range(from, to), "Riwayat pasien"));
  } catch (error) {
    if (error instanceof ListLoadError) throw error;
    throw gagal();
  }
  const rekamIds = new Set(idRekam);
  if (item.some((i) => !rekamIds.has(i.medical_record_id))) throw gagal();

  return {
    status: "ada",
    profil: susunProfil(hewan, lain, isPlaceholderOwnerName),
    kunjungan: susunKunjungan({ rpc, kunjungan, rekam, item, rawatInap }),
    total,
    adaLagi: rpc.length < total,
    muatan,
    cabangAktif,
  };
}
