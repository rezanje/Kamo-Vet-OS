// Edit Faktur Penjualan grosir per baris — aturan murni, dipakai layar dan diuji terpisah.
//
// Stok dan HPP grosir lahir di PENGIRIMAN, bukan di faktur. Mengubah faktur tidak
// mengembalikan barang: yang berubah adalah piutang, pendapatan, diskon, PPN, dan
// alokasi HPP per baris faktur. Database menghitung ulang semuanya; angka di sini
// hanya untuk pratinjau layar supaya pengguna tidak menyimpan perubahan buta.

import Decimal from "decimal.js";

export type BarisFakturEdit = {
  id: string;
  nama: string;
  satuan: string | null;
  qty: number;
  harga: number;
  diskon: number;
  /** Qty maksimal = sudah dikirim dan belum ditagih faktur lain, ditambah qty baris ini. */
  maksQty: number;
};

export type PenerimaanFaktur = {
  id: string;
  jumlah: number;
  voided_at: string | null;
  reversal_of: string | null;
};

/** Penerimaan yang masih berlaku: bukan baris pembalik dan belum dihapus. */
export function penerimaanAktif<T extends PenerimaanFaktur>(rows: T[]): T[] {
  return rows.filter((r) => !r.voided_at && !r.reversal_of);
}

/** Uang yang benar-benar diterima: baris pembalik bernilai negatif sehingga saling meniadakan. */
export function totalPenerimaan(rows: PenerimaanFaktur[]): number {
  return rows.reduce((a, r) => a + Number(r.jumlah), 0);
}

export type FakturRingkas = {
  status: string;
  order_id: string | null;
  opening_batch_id: string | null;
  kategori: string | null;
  carried_paid: number;
};

/**
 * Alasan faktur tidak bisa diedit, atau null kalau boleh.
 * Database memeriksa ulang semuanya; ini supaya tombol dan pesannya jelas lebih dulu.
 */
export function alasanTidakBisaEdit(
  faktur: FakturRingkas,
  penerimaan: PenerimaanFaktur[],
  adaPengganti: boolean,
): string | null {
  if (faktur.status === "batal") return "Faktur sudah dibatalkan. Buka faktur penggantinya.";
  if (adaPengganti) return "Faktur ini sudah diganti faktur lain. Buka faktur terbaru.";
  if (faktur.opening_batch_id) return "Faktur saldo awal tidak punya baris barang untuk diedit.";
  if ((faktur.kategori ?? "penjualan") === "selisih_stok") return "Faktur selisih stok lahir dari opname, bukan dari pesanan pelanggan.";
  if (!faktur.order_id) return "Faktur ini tidak terhubung ke pesanan, jadi rincian barangnya tidak bisa dihitung ulang.";
  if (Number(faktur.carried_paid) !== 0 || penerimaanAktif(penerimaan).length > 0) {
    return "Faktur ini sudah punya penerimaan. Hapus penerimaan dulu lewat Aksi → Hapus penerimaan, baru faktur bisa diedit.";
  }
  return null;
}

/** Nilai baris = qty × harga − diskon. */
export function subtotalBaris(baris: { qty: number; harga: number; diskon: number }): number {
  return new Decimal(baris.qty).times(baris.harga).minus(baris.diskon).toNumber();
}

export type RingkasanFaktur = { gross: number; diskon: number; dpp: number; ppn: number; total: number };

/** Pratinjau nilai faktur. PPN dibulatkan ke rupiah seperti di database. */
export function ringkasanFaktur(baris: { qty: number; harga: number; diskon: number }[], taxRate: number): RingkasanFaktur {
  let gross = new Decimal(0);
  let diskon = new Decimal(0);
  for (const b of baris) {
    gross = gross.plus(new Decimal(b.qty).times(b.harga));
    diskon = diskon.plus(b.diskon);
  }
  const dpp = gross.minus(diskon);
  const ppn = taxRate > 0 ? dpp.times(taxRate).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP) : new Decimal(0);
  return { gross: gross.toNumber(), diskon: diskon.toNumber(), dpp: dpp.toNumber(), ppn: ppn.toNumber(), total: dpp.plus(ppn).toNumber() };
}

const angkaWajar = (n: number, maks: number) => Number.isFinite(n) && n >= 0 && n <= maks;

/** Pesan kesalahan baris, atau null kalau isinya sudah bisa dikirim ke database. */
export function validasiBarisFaktur(baris: BarisFakturEdit): string | null {
  if (!angkaWajar(baris.qty, 1_000_000_000)) return "Qty harus angka 0 atau lebih.";
  if (!angkaWajar(baris.harga, 1_000_000_000)) return "Harga harus angka 0 atau lebih.";
  if (!angkaWajar(baris.diskon, 1_000_000_000_000)) return "Diskon harus angka 0 atau lebih.";
  if (baris.qty > baris.maksQty) {
    return `Qty melebihi barang yang sudah dikirim dan belum ditagih (maksimal ${baris.maksQty}).`;
  }
  if (new Decimal(baris.diskon).greaterThan(new Decimal(baris.qty).times(baris.harga))) {
    return "Diskon melebihi nilai barisnya.";
  }
  return null;
}

/**
 * Seluruh baris faktur harus ikut dikirim: database menolak kiriman yang tidak
 * menyebut semua baris tepat sekali, supaya tidak ada baris yang hilang diam-diam.
 */
export function muatanBarisFaktur(semua: BarisFakturEdit[], diubah: BarisFakturEdit): { id: string; qty: number; harga: number; diskon: number }[] {
  return semua.map((b) => {
    const dipakai = b.id === diubah.id ? diubah : b;
    return { id: b.id, qty: Number(dipakai.qty), harga: Number(dipakai.harga), diskon: Number(dipakai.diskon) };
  });
}
