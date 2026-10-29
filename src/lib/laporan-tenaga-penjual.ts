// Laporan Penjualan per Tenaga Penjual — logika murni (tanpa database), dites di
// __tests__/laporan-tenaga-penjual.test.ts.
//
// Yang dijawab laporan ini: "siapa yang menjual, berapa, dari kanal mana".
// Sejak atribusi per baris (PR #306) setiap baris kasir maupun klinik membawa dua
// kolom pelaksana: Dokter dan Non-dokter. Satu baris karena itu bisa menjadi milik
// DUA orang sekaligus.
//
// ATURAN HITUNG (diputuskan Andri, 29 Okt 2026):
//   - Baris dengan Dokter DAN Non-dokter dihitung penuh untuk masing-masing orang,
//     di kolom perannya sendiri. Tidak ada pembagian 50/50 — ini laporan kinerja,
//     bukan perhitungan komisi.
//   - "Total perusahaan" menghitung tiap baris SEKALI, jadi jumlah seluruh orang
//     boleh lebih besar dari total perusahaan. Keduanya ditampilkan terpisah.
//   - Baris tanpa pelaksana dan tanpa penjual lama masuk ember "Tanpa tenaga penjual".

import type { JenisBarisPenjualan } from "./laporan-penjualan-barang";

export type PeranPenjual = "Dokter" | "Non-dokter" | "Penjual";
export const PERAN_SEMUA: PeranPenjual[] = ["Dokter", "Non-dokter", "Penjual"];
export const LABEL_PERAN: Record<PeranPenjual, string> = {
  Dokter: "Dokter",
  "Non-dokter": "Non-dokter",
  Penjual: "Penjual (dokumen lama)",
};

export type KanalPenjual = "Petshop" | "Klinik" | "Grosir";
export const KANAL_PENJUAL: KanalPenjual[] = ["Petshop", "Klinik", "Grosir"];
export const LABEL_KANAL_PENJUAL: Record<KanalPenjual, string> = {
  Petshop: "Petshop / kasir",
  Klinik: "Klinik",
  Grosir: "Grosir (faktur)",
};

export const JENIS_PENJUAL: JenisBarisPenjualan[] = ["Barang", "Obat", "Jasa", "Racikan", "Biaya Admin"];

/** Satu baris penjualan (atau baris retur) yang sudah siap dinisbahkan ke orang. */
export type BarisPenjual = {
  /** Kunci unik baris — dipakai agar total perusahaan tidak menghitungnya dua kali. */
  id: string;
  dokumenId: string;
  dokumen: string;
  href: string;
  /** ISO, hanya untuk pengurutan. */
  waktu: string;
  /** Tanggal WIB yang dibaca pengguna. */
  tanggal: string;
  kanal: KanalPenjual;
  jenis: JenisBarisPenjualan;
  cabangId: string | null;
  cabang: string;
  pelanggan: string;
  pasien: string;
  item: string;
  qty: number;
  /** qty × harga sebelum potongan apa pun. */
  bruto: number;
  /** Setelah potongan baris dan bagian potongan kepala dokumen. */
  netto: number;
  dokterId: string | null;
  stafId: string | null;
  /** Isian "Penjual SKU"/kasir/pembuat faktur — hanya dipakai bila tidak ada pelaksana. */
  penjualId: string | null;
  /** Baris retur/refund: qty dan nilainya negatif. */
  retur: boolean;
};

/** Pasangan (baris × orang × peran). Baris tanpa siapa pun tetap muncul sekali dengan orang null. */
export type AtribusiPenjual = { baris: BarisPenjual; employeeId: string | null; peran: PeranPenjual | null };

export function atribusiPenjual(rows: readonly BarisPenjual[]): AtribusiPenjual[] {
  return rows.flatMap((baris) => {
    const pasangan: AtribusiPenjual[] = [];
    if (baris.dokterId) pasangan.push({ baris, employeeId: baris.dokterId, peran: "Dokter" });
    if (baris.stafId) pasangan.push({ baris, employeeId: baris.stafId, peran: "Non-dokter" });
    // Isian penjual lama hanya berlaku untuk dokumen yang belum punya atribusi per baris.
    if (pasangan.length === 0 && baris.penjualId) pasangan.push({ baris, employeeId: baris.penjualId, peran: "Penjual" });
    return pasangan.length > 0 ? pasangan : [{ baris, employeeId: null, peran: null }];
  });
}

export type SaringanPenjual = {
  cabangId?: string;
  kanal?: string;
  peran?: string;
  karyawanId?: string;
  jenis?: string;
};

/**
 * Saringan dijalankan pada PASANGAN, bukan pada baris: memilih peran "Dokter"
 * menyisakan sisi dokter dari baris berdua, bukan membuang barisnya.
 */
export function saringAtribusi(rows: readonly AtribusiPenjual[], saringan: SaringanPenjual): AtribusiPenjual[] {
  return rows.filter(({ baris, employeeId, peran }) =>
    (!saringan.cabangId || baris.cabangId === saringan.cabangId)
    && (!saringan.kanal || baris.kanal === saringan.kanal)
    && (!saringan.jenis || baris.jenis === saringan.jenis)
    && (!saringan.peran || peran === saringan.peran)
    && (!saringan.karyawanId || employeeId === saringan.karyawanId));
}

const kanalKosong = (): Record<KanalPenjual, number> => ({ Petshop: 0, Klinik: 0, Grosir: 0 });
const jenisKosong = (): Record<JenisBarisPenjualan, number> =>
  ({ Barang: 0, Obat: 0, Jasa: 0, Racikan: 0, "Biaya Admin": 0 });
const peranKosong = (): Record<PeranPenjual, number> => ({ Dokter: 0, "Non-dokter": 0, Penjual: 0 });

export type RekapPenjual = {
  /** null = ember "Tanpa tenaga penjual". */
  employeeId: string | null;
  peran: PeranPenjual[];
  transaksi: number;
  baris: number;
  qty: number;
  bruto: number;
  diskon: number;
  netto: number;
  perKanal: Record<KanalPenjual, number>;
  perJenis: Record<JenisBarisPenjualan, number>;
  perPeran: Record<PeranPenjual, number>;
};

export type TotalPerusahaan = Omit<RekapPenjual, "employeeId" | "peran" | "perPeran">;

type Akumulator = RekapPenjual & { dokumen: Set<string> };

function akumulatorBaru(employeeId: string | null): Akumulator {
  return {
    employeeId, peran: [], transaksi: 0, baris: 0, qty: 0, bruto: 0, diskon: 0, netto: 0,
    perKanal: kanalKosong(), perJenis: jenisKosong(), perPeran: peranKosong(), dokumen: new Set<string>(),
  };
}

function tambah(akun: Akumulator, baris: BarisPenjual, peran: PeranPenjual | null): void {
  akun.dokumen.add(baris.dokumenId);
  akun.baris += 1;
  akun.qty += baris.qty;
  akun.bruto += baris.bruto;
  akun.diskon += baris.bruto - baris.netto;
  akun.netto += baris.netto;
  akun.perKanal[baris.kanal] += baris.netto;
  akun.perJenis[baris.jenis] += baris.netto;
  if (peran) {
    akun.perPeran[peran] += baris.netto;
    if (!akun.peran.includes(peran)) akun.peran.push(peran);
  }
}

function selesaikan({ dokumen, ...rekap }: Akumulator): RekapPenjual {
  return { ...rekap, transaksi: dokumen.size, peran: PERAN_SEMUA.filter((p) => rekap.peran.includes(p)) };
}

export type HasilRekapPenjual = {
  orang: RekapPenjual[];
  /** null bila setiap baris sudah punya pemilik. */
  tanpaPenjual: RekapPenjual | null;
  /** Tiap baris dihitung SEKALI, berapa pun jumlah orang yang mengerjakannya. */
  total: TotalPerusahaan;
};

export function rekapTenagaPenjual(atribusi: readonly AtribusiPenjual[]): HasilRekapPenjual {
  const perOrang = new Map<string, Akumulator>();
  const tanpa = akumulatorBaru(null);
  let adaTanpa = false;
  const perusahaan = akumulatorBaru(null);
  const barisTerhitung = new Set<string>();

  for (const { baris, employeeId, peran } of atribusi) {
    if (employeeId) {
      const akun = perOrang.get(employeeId) ?? akumulatorBaru(employeeId);
      tambah(akun, baris, peran);
      perOrang.set(employeeId, akun);
    } else {
      adaTanpa = true;
      tambah(tanpa, baris, null);
    }
    // Total perusahaan: baris yang dikerjakan berdua tetap satu baris penjualan.
    if (!barisTerhitung.has(baris.id)) {
      barisTerhitung.add(baris.id);
      tambah(perusahaan, baris, null);
    }
  }

  const selesai = selesaikan(perusahaan);
  const total: TotalPerusahaan = {
    transaksi: selesai.transaksi, baris: selesai.baris, qty: selesai.qty,
    bruto: selesai.bruto, diskon: selesai.diskon, netto: selesai.netto,
    perKanal: selesai.perKanal, perJenis: selesai.perJenis,
  };
  return {
    orang: [...perOrang.values()].map(selesaikan).sort((a, b) => b.netto - a.netto || (a.employeeId ?? "").localeCompare(b.employeeId ?? "")),
    tanpaPenjual: adaTanpa ? selesaikan(tanpa) : null,
    total,
  };
}

/** Baris milik satu orang, terbaru di atas — isi panel rincian per orang. */
export function barisPerOrang(atribusi: readonly AtribusiPenjual[], employeeId: string | null): { baris: BarisPenjual; peran: PeranPenjual | null }[] {
  return atribusi
    .filter((row) => row.employeeId === employeeId)
    .map(({ baris, peran }) => ({ baris, peran }))
    .sort((a, b) => b.baris.waktu.localeCompare(a.baris.waktu) || a.baris.id.localeCompare(b.baris.id));
}
