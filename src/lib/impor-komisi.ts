// Impor massal aturan komisi & target penjualan (S9).
// Murni, dites di __tests__/impor-komisi.test.ts. Pembacaan CSV-nya di impor-csv.ts.
//
// Aturan yang sama dengan impor master lain: baris bermasalah dilewati dan
// dilaporkan, tidak menggugurkan baris lain, dan master pendukung (karyawan,
// cabang, kategori, barang) TIDAK dibuat otomatis — kalau namanya tidak ketemu,
// barisnya ditolak. Menebak nama karyawan bisa membayar komisi ke orang yang salah.

import { angka, type BarisCsv, type BarisSalah } from "./impor-csv";

export type Hasil<T> = { siap: T[]; salah: BarisSalah[] };

const teks = (v: string | undefined, batas = 120) => (v ?? "").trim().slice(0, batas);

/** Nama master dicocokkan tanpa peduli huruf besar-kecil & spasi berlebih. */
export const kunciNama = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");

export type MasterKomisi = {
  /** nama karyawan (huruf kecil) → id */
  karyawan: Map<string, string>;
  cabang: Map<string, string>;
  kategori: Map<string, string>;
  /** kode ATAU nama barang (huruf kecil) → id */
  barang: Map<string, string>;
};

const TIPE = ["persen", "nominal"] as const;
const BASIS = ["omzet", "laba"] as const;
const SUMBER = ["semua", "kasir", "klinik", "reseller"] as const;

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const PERIODE = /^\d{4}-\d{2}$/;

// ── Aturan komisi ────────────────────────────────────────────────────────────

export const KOLOM_KOMISI = [
  "nama", "tipe", "basis", "sumber", "persen", "nominal",
  "karyawan", "cabang", "kategori", "barang", "min_omzet", "dari", "sampai",
] as const;
export const WAJIB_KOMISI = ["nama", "tipe"] as const;

export const CONTOH_KOMISI = [
  KOLOM_KOMISI.join(","),
  "Komisi kasir petshop,persen,omzet,kasir,2,,,,,,5000000,2026-01-01,",
  "Insentif dokter klinik,persen,laba,klinik,5,,drh Fanny,,,,0,,",
  "Bonus per botol vaksin,nominal,omzet,semua,,2000,,,,TIND0005,0,,",
].join("\n");

export type KomisiImpor = {
  nama: string;
  tipe: "persen" | "nominal";
  basis: "omzet" | "laba";
  sumber: string;
  persen: number;
  nominal: number;
  employee_id: string | null;
  branch_id: string | null;
  category_id: string | null;
  item_id: string | null;
  min_omzet: number;
  berlaku_dari: string | null;
  berlaku_sampai: string | null;
  is_active: boolean;
};

export function periksaKomisi(baris: BarisCsv[], master: MasterKomisi): Hasil<KomisiImpor> {
  const siap: KomisiImpor[] = [];
  const salah: BarisSalah[] = [];
  const namaDiFile = new Set<string>();

  for (const b of baris) {
    const d = b.data;
    const nama = teks(d.nama, 100);
    const tolak = (pesan: string) => salah.push({ no: b.no, kode: nama || "—", pesan });

    if (!nama) { tolak("Nama aturan kosong"); continue; }
    if (namaDiFile.has(kunciNama(nama))) { tolak("Nama aturan kembar di dalam file ini"); continue; }

    const tipe = teks(d.tipe, 20).toLowerCase();
    if (!(TIPE as readonly string[]).includes(tipe)) {
      tolak(`Tipe "${teks(d.tipe, 20)}" tidak dikenal — isi persen atau nominal`); continue;
    }

    const basisTeks = teks(d.basis, 20).toLowerCase() || "omzet";
    if (!(BASIS as readonly string[]).includes(basisTeks)) {
      tolak(`Basis "${teks(d.basis, 20)}" tidak dikenal — isi omzet atau laba`); continue;
    }

    const sumber = teks(d.sumber, 20).toLowerCase() || "semua";
    if (!(SUMBER as readonly string[]).includes(sumber)) {
      tolak(`Sumber "${teks(d.sumber, 20)}" tidak dikenal — isi semua/kasir/klinik/reseller`); continue;
    }

    const persen = angka(d.persen ?? "") ?? 0;
    const nominal = angka(d.nominal ?? "") ?? 0;
    // Aturan tanpa angka tidak pernah membayar apa pun — lebih baik ditolak di sini
    // daripada diam-diam jadi aturan mati yang bikin orang mengira komisinya jalan.
    if (tipe === "persen" && persen <= 0) { tolak("Tipe persen tapi kolom persen kosong atau nol"); continue; }
    if (tipe === "nominal" && nominal <= 0) { tolak("Tipe nominal tapi kolom nominal kosong atau nol"); continue; }
    if (tipe === "persen" && persen > 100) { tolak(`Persen ${persen} lebih dari 100`); continue; }

    const cari = (
      isi: string | undefined, peta: Map<string, string>, label: string,
    ): { ok: true; id: string | null } | { ok: false; pesan: string } => {
      const t = teks(isi, 100);
      if (!t) return { ok: true, id: null };
      const id = peta.get(kunciNama(t));
      return id ? { ok: true, id } : { ok: false, pesan: `${label} "${t}" tidak ditemukan di master` };
    };

    const emp = cari(d.karyawan, master.karyawan, "Karyawan");
    if (!emp.ok) { tolak(emp.pesan); continue; }
    const cab = cari(d.cabang, master.cabang, "Cabang");
    if (!cab.ok) { tolak(cab.pesan); continue; }
    const kat = cari(d.kategori, master.kategori, "Kategori");
    if (!kat.ok) { tolak(kat.pesan); continue; }
    const brg = cari(d.barang, master.barang, "Barang");
    if (!brg.ok) { tolak(brg.pesan); continue; }

    const dari = teks(d.dari, 10);
    const sampai = teks(d.sampai, 10);
    if (dari && !TANGGAL.test(dari)) { tolak(`Tanggal mulai "${dari}" harus format YYYY-MM-DD`); continue; }
    if (sampai && !TANGGAL.test(sampai)) { tolak(`Tanggal akhir "${sampai}" harus format YYYY-MM-DD`); continue; }
    if (dari && sampai && sampai < dari) { tolak("Tanggal akhir lebih awal dari tanggal mulai"); continue; }

    namaDiFile.add(kunciNama(nama));
    siap.push({
      nama, tipe: tipe as "persen" | "nominal", basis: basisTeks as "omzet" | "laba", sumber,
      persen, nominal,
      employee_id: emp.id, branch_id: cab.id, category_id: kat.id, item_id: brg.id,
      min_omzet: Math.max(0, angka(d.min_omzet ?? "") ?? 0),
      berlaku_dari: dari || null,
      berlaku_sampai: sampai || null,
      is_active: true,
    });
  }

  return { siap, salah };
}

// ── Target penjualan ─────────────────────────────────────────────────────────

export const KOLOM_TARGET = ["periode", "target", "basis", "karyawan", "cabang", "kategori"] as const;
export const WAJIB_TARGET = ["periode", "target"] as const;

export const CONTOH_TARGET = [
  KOLOM_TARGET.join(","),
  "2026-09,150000000,omzet,,Kamo Petshop Loji,",
  "2026-09,40000000,omzet,Siti Ambar Rahayu,,",
  "2026-09,25000000,laba,,,Makanan / Pakan",
].join("\n");

export type TargetImpor = {
  periode: string;
  target: number;
  basis: "omzet" | "laba";
  employee_id: string | null;
  branch_id: string | null;
  category_id: string | null;
};

export type MasterTarget = Omit<MasterKomisi, "barang"> & {
  /** Cakupan target yang sudah ada: `periode|emp|cab|kat` */
  sudahAda: Set<string>;
};

/** Penanda cakupan sebuah target — dipakai menolak target kembar. */
export function kunciTarget(t: {
  periode: string; employee_id: string | null; branch_id: string | null; category_id: string | null;
}): string {
  return [t.periode, t.employee_id ?? "-", t.branch_id ?? "-", t.category_id ?? "-"].join("|");
}

export function periksaTarget(baris: BarisCsv[], master: MasterTarget): Hasil<TargetImpor> {
  const siap: TargetImpor[] = [];
  const salah: BarisSalah[] = [];
  const diFile = new Set<string>();

  for (const b of baris) {
    const d = b.data;
    const periode = teks(d.periode, 7);
    const tolak = (pesan: string) => salah.push({ no: b.no, kode: periode || "—", pesan });

    if (!PERIODE.test(periode)) { tolak(`Periode "${teks(d.periode, 20)}" harus format YYYY-MM`); continue; }

    const target = angka(d.target ?? "") ?? 0;
    if (target <= 0) { tolak("Target kosong atau nol"); continue; }

    const basisTeks = teks(d.basis, 20).toLowerCase() || "omzet";
    if (!(BASIS as readonly string[]).includes(basisTeks)) {
      tolak(`Basis "${teks(d.basis, 20)}" tidak dikenal — isi omzet atau laba`); continue;
    }

    const cari = (
      isi: string | undefined, peta: Map<string, string>, label: string,
    ): { ok: true; id: string | null } | { ok: false; pesan: string } => {
      const t = teks(isi, 100);
      if (!t) return { ok: true, id: null };
      const id = peta.get(kunciNama(t));
      return id ? { ok: true, id } : { ok: false, pesan: `${label} "${t}" tidak ditemukan di master` };
    };

    const emp = cari(d.karyawan, master.karyawan, "Karyawan");
    if (!emp.ok) { tolak(emp.pesan); continue; }
    const cab = cari(d.cabang, master.cabang, "Cabang");
    if (!cab.ok) { tolak(cab.pesan); continue; }
    const kat = cari(d.kategori, master.kategori, "Kategori");
    if (!kat.ok) { tolak(kat.pesan); continue; }

    const baru: TargetImpor = {
      periode, target, basis: basisTeks as "omzet" | "laba",
      employee_id: emp.id, branch_id: cab.id, category_id: kat.id,
    };
    const kunci = kunciTarget(baru);
    // Dua target untuk cakupan yang sama bikin capaiannya terhitung dua kali.
    if (diFile.has(kunci)) { tolak("Target dengan cakupan yang sama sudah ada di file ini"); continue; }
    if (master.sudahAda.has(kunci)) { tolak("Target dengan cakupan yang sama sudah tersimpan"); continue; }

    diFile.add(kunci);
    siap.push(baru);
  }

  return { siap, salah };
}
