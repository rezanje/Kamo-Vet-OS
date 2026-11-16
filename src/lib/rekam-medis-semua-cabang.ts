import { ListLoadError } from "@/lib/checked-list";
import { hasActiveInpatient, statusPasienRekamMedis, type CatatanStatusRawatInap } from "@/lib/status-pasien-rekam-medis";
import type { KelompokPasien } from "@/lib/rekam-medis-per-pasien";

/**
 * Per pasien: jumlah kunjungan + kunjungan terakhir dihitung dari SEMUA cabang yang boleh dibaca pengguna
 * (RLS pemanggil tanpa header cabang), bukan hanya cabang aktif. Hewan yang tampil tetap ditentukan jendela daftar.
 * Modul ini murni (tanpa database); pembacaannya ada di rekam-medis-semua-cabang-server.ts.
 */

/** Batas kunjungan yang dihitung per hewan; lebih dari ini ditampilkan "200+". */
export const MAKS_KUNJUNGAN_PER_HEWAN = 200;
/** Batas baris sekali baca = hewan per halaman (20) x batas per hewan. */
export const MAKS_BARIS_SEMUA_CABANG = 4000;

type Rel<T> = T | T[] | null | undefined;
const satu = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Kolom minimal satu kunjungan (bacaan `visits` yang sudah memuat rekam medis, tidak diarsipkan). */
export type SumberKunjunganSemua = {
  id: string;
  pet_id: string | null;
  created_at: string;
  branch_id: string | null;
  status: string | null;
  poli: string | null;
  keluhan: string | null;
  legacy_source_key: string | null;
  branches?: Rel<{ code: string | null }>;
  inpatient_records?: CatatanStatusRawatInap[] | CatatanStatusRawatInap | null;
};

/** Isi klinis ringkas kunjungan terakhir bila bukan kunjungan yang sudah ada di jendela. */
export type RekamRingkas = { visit_id: string; diagnosis: string | null; anamnesis: string | null };

export type TerakhirSemuaCabang = {
  id: string;
  date: string;
  branchId: string | null;
  /** Kode cabang; null untuk riwayat impor/tanpa cabang. */
  branch: string | null;
  isImported: boolean;
  patientStatus: ReturnType<typeof statusPasienRekamMedis>;
  note: string | null;
  diagnosis: string | null;
  /** Kunjungan terakhir ini termasuk cabang aktif (+ impor), jadi tombol "Buka terakhir" membukanya. */
  dalamCabangIni: boolean;
};

export type RingkasanSemuaCabang = {
  jumlah: number;
  jumlahRawatInap: number;
  /** Kunjungan pada cabang aktif (+ riwayat impor tanpa cabang); null bila tidak ada cabang aktif ("Semua cabang"). */
  jumlahCabangIni: number | null;
  /** Hitungan terpotong (batas per hewan / batas baca): tampil dengan tanda "+". */
  lebih: boolean;
  terakhir: TerakhirSemuaCabang;
};

const lebihBaru = (a: SumberKunjunganSemua, b: SumberKunjunganSemua) =>
  a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const daftarInap = (v: SumberKunjunganSemua): CatatanStatusRawatInap[] =>
  Array.isArray(v.inpatient_records) ? v.inpatient_records : v.inpatient_records ? [v.inpatient_records] : [];

/** Sama dengan lingkup RPC daftar untuk cabang aktif: cabang itu + riwayat impor tanpa cabang. */
export const dalamLingkupCabang = (v: Pick<SumberKunjunganSemua, "branch_id" | "legacy_source_key">, cabangAktif: string | null) =>
  cabangAktif === null || v.branch_id === cabangAktif || (v.branch_id === null && Boolean(v.legacy_source_key));

/** ID kunjungan terakhir (semua cabang) per hewan yang BUKAN kunjungan terakhir di jendela daftar: isinya perlu dibaca. */
export function idKunjunganTerakhirPerluDetail(kelompok: KelompokPasien[], sumber: SumberKunjunganSemua[], tampilan: string): string[] {
  const ids: string[] = [];
  for (const g of kelompok) {
    if (!g.petId) continue;
    const terakhir = urutkanUntukHewan(sumber, g.petId, tampilan)[0];
    if (terakhir && terakhir.id !== g.terakhir.id) ids.push(terakhir.id);
  }
  return ids;
}

function urutkanUntukHewan(sumber: SumberKunjunganSemua[], petId: string, tampilan: string): SumberKunjunganSemua[] {
  return sumber
    .filter((v) => v.pet_id === petId)
    // Aturan daftar yang sama: tampilan "rawat-jalan" menyembunyikan kunjungan yang rawat inapnya masih aktif.
    .filter((v) => tampilan === "semua" || !hasActiveInpatient(daftarInap(v)))
    .sort(lebihBaru);
}

/**
 * Menggabungkan bacaan semua cabang ke kelompok hewan di halaman ini. Hasil per `kunci` kelompok; hewan tanpa pet_id
 * tidak ikut (tidak bisa digabung). `terpotong` = bacaan sumber berhenti di batas baris, jadi semua hitungan bertanda +.
 *
 * Fail-closed: kunjungan yang membuat hewan itu muncul di daftar harus ada di sumber (lingkup semua cabang adalah
 * superset lingkup cabang aktif). Bila tidak ada dan bacaan tidak terpotong, data tidak konsisten -> galat, bukan angka salah.
 */
export function gabungkanSemuaCabang(input: {
  kelompok: KelompokPasien[];
  sumber: SumberKunjunganSemua[];
  rekam: RekamRingkas[];
  cabangAktif: string | null;
  tampilan: string;
  terpotong: boolean;
}): Map<string, RingkasanSemuaCabang> {
  const hasil = new Map<string, RingkasanSemuaCabang>();
  const rekamPerKunjungan = new Map<string, RekamRingkas>();
  for (const r of input.rekam) if (!rekamPerKunjungan.has(r.visit_id)) rekamPerKunjungan.set(r.visit_id, r);

  for (const g of input.kelompok) {
    if (!g.petId) continue;
    const semua = urutkanUntukHewan(input.sumber, g.petId, input.tampilan);
    if (semua.length === 0) {
      if (!input.terpotong) throw new ListLoadError("Jumlah kunjungan semua cabang tidak konsisten dengan daftar. Coba muat ulang.");
      continue; // terpotong: pakai angka jendela (bertanda +) lewat g sendiri
    }
    const dihitung = semua.slice(0, MAKS_KUNJUNGAN_PER_HEWAN);
    const lebih = semua.length > MAKS_KUNJUNGAN_PER_HEWAN || input.terpotong;
    const t = dihitung[0];
    const rekam = rekamPerKunjungan.get(t.id);
    const dariJendela = t.id === g.terakhir.id;
    const cabang = satu(t.branches)?.code ?? null;
    const imporT = Boolean(t.legacy_source_key);
    hasil.set(g.kunci, {
      jumlah: dihitung.length,
      jumlahRawatInap: dihitung.filter((v) => daftarInap(v).length > 0).length,
      jumlahCabangIni: input.cabangAktif === null ? null : dihitung.filter((v) => dalamLingkupCabang(v, input.cabangAktif)).length,
      lebih,
      terakhir: {
        id: t.id, date: t.created_at, branchId: t.branch_id, branch: cabang, isImported: imporT,
        patientStatus: statusPasienRekamMedis(daftarInap(t), imporT),
        note: dariJendela ? g.terakhir.note : (rekam?.anamnesis ?? t.keluhan),
        diagnosis: dariJendela ? g.terakhir.diagnosis : (rekam?.diagnosis ?? null),
        dalamCabangIni: dalamLingkupCabang(t, input.cabangAktif),
      },
    });
  }
  return hasil;
}
