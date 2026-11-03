// Petugas yang tercetak di dokumen klinik (struk 80 mm, invoice A4, struk rombongan),
// dikelompokkan menurut JABATAN di kartu karyawan.
//
// Latar (grup klinik, 3 Nov 2026): kunjungan grooming dicatat dengan groomer sebagai
// PJ, lalu struk mencetak "Dokter PJ: <nama groomer>". Pelanggan pernah salah menuduh
// dokter karena nama di struk tidak sesuai. Disepakati Aldi/Andri/Reza: cetakan
// menyebut petugas per jabatan —
//
//   Dokter  : dokter yang memeriksa
//   Groomer : groomer yang mengerjakan
//   Staff   : selain dokter & groomer (paramedis, kasir, kepala toko, dll.)
//
// Sumber nama: PJ kunjungan (`visits.doctor_id`, atau teks lama `visits.dokter`) dan
// pelaksana per baris (`service_performers.doctor_id` / `staff_id`). Satu orang hanya
// muncul sekali. Nama per baris memakai nama yang tersimpan saat transaksi; nama PJ
// memakai kartu karyawan seperti sebelumnya (lihat `dokter-pj.ts`).
//
// Kelompok ditentukan dari jabatan di kartu karyawan. Jabatan kosong / tidak terbaca
// jatuh ke slot asalnya: slot dokter → Dokter, slot non-dokter → Staff, PJ kunjungan
// → Groomer bila poli Grooming, selain itu Dokter.

import { clinicalRoles } from "./clinical-staff";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type KelompokPetugas = "Dokter" | "Groomer" | "Staff";
export const URUTAN_KELOMPOK: readonly KelompokPetugas[] = ["Dokter", "Groomer", "Staff"];
export type BarisPetugas = { label: KelompokPetugas; nama: string };

export type KartuPetugas = { nama: string; jabatan: string | null };
export type KunjunganPetugas = { poli?: string | null; doctor_id?: string | null; dokter?: string | null };
type Snapshot = { doctor_id?: string | null; doctor_name?: string | null; staff_id?: string | null; staff_name?: string | null };
export type BarisTagihanPetugas = { service_performers?: Snapshot | null };

function kelompokDariJabatan(jabatan: string | null | undefined): KelompokPetugas | null {
  const roles = clinicalRoles(jabatan ?? null);
  if (roles.includes("doctor")) return "Dokter";
  if (roles.includes("groomer")) return "Groomer";
  return (jabatan ?? "").trim() ? "Staff" : null;
}

const bersih = (teks: string | null | undefined) => (teks ?? "").trim() || null;

/** Daftar baris "Dokter / Groomer / Staff" untuk satu kunjungan. Kelompok kosong tidak dicetak. */
export function petugasCetak(
  visit: KunjunganPetugas | null | undefined,
  lines: readonly BarisTagihanPetugas[],
  kartu: ReadonlyMap<string, KartuPetugas>,
): BarisPetugas[] {
  const grup = new Map<KelompokPetugas, string[]>(URUTAN_KELOMPOK.map((k) => [k, []]));
  const sudah = new Set<string>();
  const tambah = (kunci: string, nama: string | null, slot: KelompokPetugas, id?: string | null) => {
    if (!nama || sudah.has(kunci)) return;
    sudah.add(kunci);
    const kelompok = kelompokDariJabatan(id ? kartu.get(id)?.jabatan : null) ?? slot;
    const daftar = grup.get(kelompok)!;
    if (!daftar.includes(nama)) daftar.push(nama);
  };

  if (visit) {
    const slotPJ: KelompokPetugas = (visit.poli ?? "").trim().toLowerCase() === "grooming" ? "Groomer" : "Dokter";
    if (visit.doctor_id) tambah(visit.doctor_id, bersih(kartu.get(visit.doctor_id)?.nama) ?? bersih(visit.dokter), slotPJ, visit.doctor_id);
    else tambah(`teks:${bersih(visit.dokter)}`, bersih(visit.dokter), slotPJ);
  }
  for (const line of lines) {
    const p = line.service_performers;
    if (!p) continue;
    if (p.doctor_id) tambah(p.doctor_id, bersih(p.doctor_name) ?? bersih(kartu.get(p.doctor_id)?.nama), "Dokter", p.doctor_id);
    if (p.staff_id) tambah(p.staff_id, bersih(p.staff_name) ?? bersih(kartu.get(p.staff_id)?.nama), "Staff", p.staff_id);
  }
  return URUTAN_KELOMPOK.flatMap((label) => {
    const nama = grup.get(label)!;
    return nama.length ? [{ label, nama: nama.join(", ") }] : [];
  });
}

/** Semua id karyawan yang perlu dibaca kartunya untuk `petugasCetak`. */
export function idPetugas(
  visits: readonly (KunjunganPetugas | null | undefined)[],
  lines: readonly BarisTagihanPetugas[],
): string[] {
  const ids = [
    ...visits.map((v) => v?.doctor_id),
    ...lines.flatMap((l) => [l.service_performers?.doctor_id, l.service_performers?.staff_id]),
  ];
  return [...new Set(ids.filter((id): id is string => !!id))];
}

/** Nama + jabatan karyawan dari kartu karyawan. Gagal baca = dokumen tidak dicetak. */
export async function bacaKartuPetugas(supabase: AnyClient, ids: readonly string[]): Promise<Map<string, KartuPetugas>> {
  const unik = [...new Set(ids.filter(Boolean))];
  const hasil = new Map<string, KartuPetugas>();
  for (let offset = 0; offset < unik.length; offset += 200) {
    const { data, error } = await supabase.from("employees").select("id, nama, jabatan").in("id", unik.slice(offset, offset + 200));
    if (error) throw new Error("Nama petugas tidak terbaca. Muat ulang sebelum mencetak.");
    for (const row of (data ?? []) as { id: string; nama: string | null; jabatan: string | null }[]) {
      hasil.set(row.id, { nama: (row.nama ?? "").trim(), jabatan: row.jabatan ?? null });
    }
  }
  return hasil;
}
