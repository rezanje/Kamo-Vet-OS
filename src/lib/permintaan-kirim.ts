// Permintaan barang — sisi gudang pengirim.
//
// Kekurangan stok harus ketahuan DI GUDANG, bukan waktu cabang menekan "Terima".
// Modul ini memegang hitungannya supaya layar persetujuan, layar kirim, dan
// pesan kesalahannya memakai angka yang sama persis dengan RPC
// `ship_stock_request_atomic` / `approve_stock_request_atomic` di database.
//
// Semua qty di sini dalam SATUAN DOKUMEN (satuan yang dipilih saat meminta).
// Saldo `stock.qty` di database selalu satuan dasar, jadi dibagi faktor dulu.

import type { BarisKurangStok } from "./stok-kurang";

export type BarisPermintaan = {
  id: string;
  nama: string;
  satuan: string | null;
  faktor: number | null;
  item_id: string | null;
  qty_diminta: number;
  qty_disetujui: number | null;
  qty_dikirim: number | null;
};

export type BarisKirim = BarisPermintaan & {
  /** Plafon baris: qty diminta (saat persetujuan) atau qty disetujui (saat kirim). */
  plafon: number;
  /** Stok gudang pengirim, dalam satuan dokumen baris ini. */
  tersedia: number;
  /** Angka yang diusulkan ke petugas: sebanyak plafon, tapi tidak melebihi stok. */
  usulan: number;
  kurang: boolean;
};

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Faktor 0/kosong/negatif tidak pernah dipakai membagi — satuan dasar = faktor 1. */
export function faktorBaris(faktor: number | null | undefined): number {
  const f = n(faktor);
  return f > 0 ? f : 1;
}

/** Saldo satuan dasar → satuan dokumen. Saldo minus dihitung nol: tidak ada yang bisa dikirim. */
export function tersediaSatuanDokumen(qtyDasar: number, faktor: number | null | undefined): number {
  return Math.max(0, n(qtyDasar)) / faktorBaris(faktor);
}

/**
 * Satu barang boleh muncul di dua baris. Stoknya tetap satu — jatahnya dibagi
 * berurutan, supaya dua baris @150 tidak dua-duanya lolos terhadap stok 250.
 */
export function siapkanKirim(
  rows: BarisPermintaan[],
  stokDasarPerItem: Map<string, number>,
  basis: "diminta" | "disetujui",
): BarisKirim[] {
  const sisa = new Map<string, number>();
  return rows.map((r) => {
    const faktor = faktorBaris(r.faktor);
    const plafon = Math.max(
      0,
      basis === "diminta" ? n(r.qty_diminta) : n(r.qty_disetujui ?? r.qty_diminta),
    );
    const key = r.item_id ?? "";
    if (!sisa.has(key)) sisa.set(key, tersediaSatuanDokumen(stokDasarPerItem.get(key) ?? 0, faktor) * faktor);
    const tersedia = (sisa.get(key) ?? 0) / faktor;
    const usulan = Math.min(plafon, tersedia);
    sisa.set(key, Math.max(0, (sisa.get(key) ?? 0) - usulan * faktor));
    return { ...r, plafon, tersedia, usulan, kurang: plafon > tersedia + 1e-9 };
  });
}

/**
 * Kekurangan per BARANG (bukan per baris), supaya angkanya cocok dengan database
 * yang juga menjumlahkan baris dengan barang sama sebelum membandingkan stok.
 * Hasilnya baris terstruktur — kalimat untuk `?error=` dibentuk pemanggil lewat
 * `formatKekuranganStok`, dan popup memakai barisnya langsung.
 */
export function kurangStokPermintaan(
  rows: BarisKirim[],
  stokDasarPerItem: Map<string, number>,
): BarisKurangStok[] {
  const perItem = new Map<string, { kunci: string; nama: string; satuan: string; faktor: number; butuh: number; ada: number }>();
  for (const r of rows) {
    if (r.plafon <= 0) continue;
    const key = r.item_id ?? r.id;
    const faktor = faktorBaris(r.faktor);
    const ada = perItem.get(key);
    if (ada) ada.butuh += r.plafon * faktor;
    else perItem.set(key, {
      kunci: r.id,
      nama: r.nama,
      satuan: r.satuan ?? "",
      faktor,
      butuh: r.plafon * faktor,
      ada: Math.max(0, n(stokDasarPerItem.get(key) ?? 0)),
    });
  }
  return [...perItem.entries()]
    .filter(([, t]) => t.butuh > t.ada + 1e-9)
    .map(([itemId, t]) => ({
      kunci: t.kunci, item_id: itemId, nama: t.nama, satuan: t.satuan,
      butuh: t.butuh / t.faktor, tersedia: t.ada / t.faktor,
    }));
}

/** Baca qty kirim dari form. Baris tanpa isian dianggap sebanyak usulannya. */
export function bacaQtyKirim(
  rows: BarisKirim[],
  ambil: (name: string) => string | null,
): { id: string; qty: number }[] {
  return rows.map((r) => {
    const raw = ambil(`qty_${r.id}`);
    const qty = raw == null || raw === "" ? r.usulan : Math.max(0, n(raw));
    return { id: r.id, qty: Math.min(qty, r.plafon) };
  });
}
