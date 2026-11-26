import { isPlaceholderOwnerName } from "@/lib/impor-rekam-medis";
import { bacaObatCocok, gabungObatCocok, type ObatCocok } from "@/lib/daftar-rekam-medis-obat";
import type { BarisDaftarRekamMedis } from "@/lib/daftar-rekam-medis";
import { hasActiveInpatient, statusPasienRekamMedis, type CatatanStatusRawatInap } from "@/lib/status-pasien-rekam-medis";

type Rel<T> = T | T[] | null;

function one<T>(value: Rel<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Bentuk satu baris hasil RPC `daftar_rekam_medis_halaman` (sama dengan yang dibaca daftar Rekam Medis). */
export type SumberBarisDaftar = {
  id: string;
  created_at: string;
  pet_id: string | null;
  branch_id: string | null;
  dokter: string | null;
  keluhan: string | null;
  legacy_source_key: string | null;
  pets: Rel<{ name: string; species: string | null; breed: string | null }>;
  customers: Rel<{ name: string; phone: string | null }>;
  branches: Rel<{ code: string }>;
  medical_records: Rel<{ diagnosis: string | null; anamnesis: string | null }>;
  inpatient_records: Rel<CatatanStatusRawatInap>;
  /** Hanya ada bila filter obat dipakai: produk yang cocok ({nama, qty, sumber}). Bentuk lain diabaikan. */
  obat_cocok?: unknown;
};

/** Satu kunjungan di daftar (dipakai tampilan Per kunjungan dan Per pasien — satu pemeta, tidak ada salinan). */
export type BarisKunjungan = BarisDaftarRekamMedis & {
  id: string;
  date: string;
  petId: string | null;
  species: string | null;
  breed: string | null;
  doctor: string | null;
  branch: string | null;
  note: string | null;
  diagnosis: string | null;
  isImported: boolean;
  activeInpatient: boolean;
  /** Kunjungan ini pernah/ sedang punya catatan rawat inap. */
  punyaRawatInap: boolean;
  patientStatus: ReturnType<typeof statusPasienRekamMedis>;
  /** Produk yang cocok dengan filter obat (kosong bila filter tidak dipakai). */
  obatCocok: ObatCocok[];
};

export function petakanKunjungan(visit: SumberBarisDaftar): BarisKunjungan {
  const pet = one(visit.pets);
  const owner = one(visit.customers);
  const branch = one(visit.branches);
  const medical = one(visit.medical_records);
  const invalidImportedOwner = Boolean(visit.legacy_source_key) && isPlaceholderOwnerName(owner?.name);
  const inap = visit.inpatient_records;
  return {
    id: visit.id,
    date: visit.created_at,
    petId: visit.pet_id,
    ownerName: invalidImportedOwner ? "Pemilik perlu verifikasi" : owner?.name ?? "—",
    petName: pet?.name ?? "—",
    phone: invalidImportedOwner ? "" : owner?.phone ?? "",
    species: pet?.species ?? null,
    breed: pet?.breed ?? null,
    doctor: visit.dokter,
    branch: branch?.code ?? null,
    note: medical?.anamnesis ?? visit.keluhan,
    diagnosis: medical?.diagnosis ?? null,
    isImported: Boolean(visit.legacy_source_key),
    activeInpatient: hasActiveInpatient(inap),
    punyaRawatInap: (Array.isArray(inap) ? inap.length : inap ? 1 : 0) > 0,
    patientStatus: statusPasienRekamMedis(inap, Boolean(visit.legacy_source_key)),
    obatCocok: bacaObatCocok(visit.obat_cocok),
  };
}

export const tanggalRekamMedis = (iso: string) => new Date(iso).toLocaleDateString("id-ID", {
  timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric",
});

// ── Pengelompokan Per pasien ──

export type KelompokDaftar = "pasien" | "kunjungan";
/** Bawaan Per pasien; hanya "kunjungan" yang memilih tampilan lama. */
export const bacaKelompok = (mentah: string | undefined): KelompokDaftar => (mentah === "kunjungan" ? "kunjungan" : "pasien");

/** Jumlah kunjungan terbaru yang dibaca lalu dikelompokkan di aplikasi (RPC maksimal 200 per panggilan). */
export const JENDELA_KUNJUNGAN = 400;
export const PASIEN_PER_HALAMAN = 20;

export type KelompokPasien = {
  /** pet_id; kunjungan tanpa pet_id tidak bisa digabung, jadi berdiri sendiri (`kunjungan:<id>`). */
  kunci: string;
  petId: string | null;
  petName: string;
  species: string | null;
  breed: string | null;
  ownerName: string;
  phone: string;
  /** Kunjungan dalam jendela yang cocok dengan filter yang sama dengan daftar Per kunjungan. */
  jumlah: number;
  jumlahRawatInap: number;
  jumlahImpor: number;
  /** Produk yang cocok dengan filter obat, dijumlah dari kunjungan hewan ini dalam jendela (kosong tanpa filter). */
  obatCocok: ObatCocok[];
  terakhir: BarisKunjungan;
  /** Ada hewan lain milik pemilik yang sama dengan nama + jenis yang sama (id berbeda) di hasil ini. Tidak digabung. */
  kembar: boolean;
};

const norm = (v: string | null | undefined) => (v ?? "").trim().toLocaleLowerCase("id-ID").replace(/\s+/g, " ");
const digit = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
const PEMILIK_TAK_DIKENAL = new Set(["—", "pemilik perlu verifikasi", ""]);

/** Urutan kunjungan: terbaru dulu, seri diputus id (stabil). */
const lebihBaru = (a: BarisKunjungan, b: BarisKunjungan) =>
  a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Kelompokkan kunjungan per hewan (pet_id SAJA — bukan teks nama+pemilik). Urut: kunjungan terakhir terbaru dulu.
 * Tidak mengubah/menggabung data; `kembar` hanya penanda dugaan hewan terdaftar ganda.
 */
export function kelompokkanPerPasien(kunjungan: BarisKunjungan[]): KelompokPasien[] {
  const peta = new Map<string, BarisKunjungan[]>();
  for (const k of kunjungan) {
    const kunci = k.petId ?? `kunjungan:${k.id}`;
    const daftar = peta.get(kunci);
    if (daftar) daftar.push(k); else peta.set(kunci, [k]);
  }
  const hasil: KelompokPasien[] = [...peta.entries()].map(([kunci, daftar]) => {
    const urut = [...daftar].sort(lebihBaru);
    const terakhir = urut[0];
    return {
      kunci, petId: terakhir.petId, petName: terakhir.petName, species: terakhir.species, breed: terakhir.breed,
      ownerName: terakhir.ownerName, phone: terakhir.phone,
      jumlah: urut.length,
      jumlahRawatInap: urut.filter((k) => k.punyaRawatInap).length,
      jumlahImpor: urut.filter((k) => k.isImported).length,
      obatCocok: gabungObatCocok(urut.map((k) => k.obatCocok)),
      terakhir, kembar: false,
    };
  });

  const serupa = new Map<string, Set<string>>();
  for (const g of hasil) {
    if (!g.petId || PEMILIK_TAK_DIKENAL.has(norm(g.ownerName)) || !norm(g.petName) || norm(g.petName) === "—") continue;
    const kunciSerupa = [norm(g.ownerName), digit(g.phone), norm(g.petName), norm(g.species)].join("|");
    const ids = serupa.get(kunciSerupa);
    if (ids) ids.add(g.petId); else serupa.set(kunciSerupa, new Set([g.petId]));
  }
  for (const g of hasil) {
    if (!g.petId) continue;
    const kunciSerupa = [norm(g.ownerName), digit(g.phone), norm(g.petName), norm(g.species)].join("|");
    g.kembar = (serupa.get(kunciSerupa)?.size ?? 0) > 1;
  }
  return hasil.sort((a, b) => lebihBaru(a.terakhir, b.terakhir));
}

/** Pasien yang dikelompokkan dari jendela kunjungan + penanda jendela terpakai habis. */
export function susunDaftarPerPasien(kunjungan: BarisKunjungan[], jumlahCocok: number, jendela: number = JENDELA_KUNJUNGAN) {
  const kelompok = kelompokkanPerPasien(kunjungan);
  return { kelompok, jendelaHabis: jumlahCocok > jendela, dibaca: kunjungan.length, jumlahCocok };
}

export const ringkasTeks = (teks: string | null | undefined, maks = 110): string | null => {
  const bersih = (teks ?? "").replace(/\s+/g, " ").trim();
  if (!bersih) return null;
  return bersih.length > maks ? `${bersih.slice(0, maks - 1).trimEnd()}…` : bersih;
};
