import type { SupabaseClient } from "@supabase/supabase-js";
import { ListLoadError } from "@/lib/checked-list";
import {
  gabungkanSemuaCabang, idKunjunganTerakhirPerluDetail, MAKS_BARIS_SEMUA_CABANG,
  type RekamRingkas, type RingkasanSemuaCabang, type SumberKunjunganSemua,
} from "@/lib/rekam-medis-semua-cabang";
import type { KelompokPasien } from "@/lib/rekam-medis-per-pasien";

const GAGAL = "Jumlah kunjungan semua cabang belum dapat dimuat lengkap. Coba muat ulang.";
const HALAMAN = 500;
const KOLOM = "id, pet_id, created_at, branch_id, status, poli, keluhan, legacy_source_key, branches(code), medical_records!inner(id), inpatient_records(created_at, discharged_at, condition_status)";

/**
 * Jumlah + kunjungan terakhir SEMUA cabang untuk hewan di halaman daftar ini (maks 20 hewan), dibaca dengan klien
 * yang sama dengan daftar: TANPA header cabang, jadi RLS pemanggil (user_can_access_branch + izin riwayat impor)
 * menentukan apa yang terlihat. "Semua cabang" = semua cabang yang boleh diakses pengguna ini; tidak ada akses
 * yang dilebarkan, tidak ada service role, tidak ada filter cabang di sini.
 *
 * Bacaan berkumpulan (tanpa N+1): (1) kolom minimal semua kunjungan hewan-hewan itu (tidak diarsipkan, punya
 * rekam medis; terbaru dulu, maks 4.000 baris = 20 hewan x 200), (2) isi klinis ringkas hanya untuk kunjungan
 * terakhir yang belum ada di jendela daftar. Galat/ketidaksesuaian = ListLoadError (tidak pernah diam-diam
 * memakai angka cabang aktif).
 */
export async function bacaSemuaCabang(
  client: Pick<SupabaseClient, "from">,
  kelompok: KelompokPasien[],
  opsi: { cabangAktif: string | null; tampilan: string },
): Promise<Map<string, RingkasanSemuaCabang>> {
  const petIds = [...new Set(kelompok.map((g) => g.petId).filter((x): x is string => Boolean(x)))];
  if (petIds.length === 0) return new Map();

  const halaman = (dari: number, sampai: number) => client.from("visits").select(KOLOM, { count: "exact" })
    .in("pet_id", petIds).is("archived_at", null).order("created_at", { ascending: false }).order("id").range(dari, sampai);

  let sumber: SumberKunjunganSemua[];
  let terpotong = false;
  try {
    const awal = await halaman(0, HALAMAN - 1);
    const jumlah = awal.count;
    if (awal.error || !Array.isArray(awal.data) || typeof jumlah !== "number" || !Number.isSafeInteger(jumlah) || jumlah < 0) throw new ListLoadError(GAGAL);
    const target = Math.min(jumlah, MAKS_BARIS_SEMUA_CABANG);
    terpotong = jumlah > MAKS_BARIS_SEMUA_CABANG;
    const periksa = (data: unknown, dari: number) => {
      if (!Array.isArray(data) || data.length !== Math.min(HALAMAN, target - dari)) throw new ListLoadError(GAGAL);
      return data as unknown as SumberKunjunganSemua[];
    };
    sumber = [...periksa(awal.data, 0)];
    const offsets: number[] = [];
    for (let dari = HALAMAN; dari < target; dari += HALAMAN) offsets.push(dari);
    const lain = await Promise.all(offsets.map(async (dari) => {
      const h = await halaman(dari, Math.min(dari + HALAMAN, target) - 1);
      if (h.error || h.count !== jumlah) throw new ListLoadError(GAGAL);
      return periksa(h.data, dari);
    }));
    for (const l of lain) sumber.push(...l);
    const ids = new Set<string>();
    for (const v of sumber) { if (!v.id || ids.has(v.id)) throw new ListLoadError(GAGAL); ids.add(v.id); }
  } catch (error) {
    if (error instanceof ListLoadError) throw error;
    throw new ListLoadError(GAGAL);
  }

  const perluDetail = idKunjunganTerakhirPerluDetail(kelompok, sumber, opsi.tampilan);
  let rekam: RekamRingkas[] = [];
  if (perluDetail.length > 0) {
    try {
      const r = await client.from("medical_records").select("visit_id, diagnosis, anamnesis").in("visit_id", perluDetail).order("id");
      if (r.error || !Array.isArray(r.data)) throw new ListLoadError(GAGAL);
      rekam = r.data as unknown as RekamRingkas[];
    } catch (error) {
      if (error instanceof ListLoadError) throw error;
      throw new ListLoadError(GAGAL);
    }
  }
  return gabungkanSemuaCabang({ kelompok, sumber, rekam, cabangAktif: opsi.cabangAktif, tampilan: opsi.tampilan, terpotong });
}
