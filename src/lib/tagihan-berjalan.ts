// Tagihan berjalan rawat inap — perhitungan murni yang dipakai layar DAN server.
//
// Pasien yang masih dirawat ditagih bertahap: tiap kali staf menekan "Tagih sekarang",
// baris resep yang belum pernah ditagih menjadi satu invoice tahap. Pembayaran boleh
// masuk kapan saja, berapa kali saja, campuran metode, dan dialokasikan ke tahap
// tertua lebih dulu. Uang yang masuk saat belum ada tagihan jadi uang muka pemilik.
//
// Aturan uang di sini HARUS sama persis dengan RPC-nya
// (clinic_post_inpatient_stage_invoice, clinic_receive_visit_payment): kalau layar
// menghitung berbeda, kasir menyebut angka yang tidak pernah tercetak di kwitansi.

import { TANPA_BAYAR, bayarPerTagihan, sisaTagihan, uangDiterimaTagihan } from "./uang-tagihan";

export const AKUN_UANG_MUKA_JUAL = "2103";
export const AKUN_PIUTANG_USAHA = "1201";
export const METODE_UANG_MUKA = "Uang Muka";

export type BarisResep = {
  id: string;
  nama_obat: string;
  qty: number;
  harga: number;
  jenis: string;
  kategori?: string | null;
  item_id: string | null;
  satuan: string | null;
  compound_recipe_id: string | null;
};

export type BarisInvoice = { invoice_id: string; prescription_item_id: string | null };
export type TagihanTahap = {
  id: string;
  invoice_no: string | null;
  created_at: string;
  total: number;
  dp_amount: number;
  paid_status: string;
  voided_at: string | null;
  correction_pending?: boolean | null;
  reissued_from?: string | null;
};
export type BarisBayar = { invoice_id: string; amount: number };

/** Nilai satu baris resep — tanpa diskon baris; diskon tahap diputuskan di layar bayar. */
export function nilaiBarisResep(row: Pick<BarisResep, "qty" | "harga">): number {
  return (Number(row.qty) || 0) * (Number(row.harga) || 0);
}

/**
 * Baris resep yang BELUM ditagih.
 *
 * Yang menutup sebuah baris hanyalah tautan ke invoice yang masih AKTIF. Begitu
 * tagihannya di-void, barisnya terbuka lagi — persis penjaga guard_invoice_item_billed_once
 * di database, supaya layar tidak pernah menawarkan baris yang nanti ditolak.
 */
export function barisBelumDitagih(
  resep: readonly BarisResep[],
  barisInvoice: readonly BarisInvoice[],
  invoices: readonly Pick<TagihanTahap, "id" | "voided_at">[],
): BarisResep[] {
  const aktif = new Set(invoices.filter((i) => !i.voided_at).map((i) => i.id));
  const tertagih = new Set(
    barisInvoice
      .filter((l) => l.prescription_item_id && aktif.has(l.invoice_id))
      .map((l) => l.prescription_item_id as string),
  );
  return resep.filter((r) => !tertagih.has(r.id));
}

export type RingkasTahap = TagihanTahap & { dibayar: number; sisa: number };

/** Tagihan tahap AKTIF beserta uang yang sudah masuk ke masing-masing. */
export function ringkasTahap(
  invoices: readonly TagihanTahap[],
  pembayaran: readonly BarisBayar[],
): RingkasTahap[] {
  const masuk = bayarPerTagihan(pembayaran);
  return invoices
    .filter((i) => !i.voided_at)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((i) => {
      const bayar = masuk.get(i.id) ?? TANPA_BAYAR;
      return { ...i, dibayar: uangDiterimaTagihan(i, bayar), sisa: sisaTagihan(i, bayar) };
    });
}

export function totalPiutang(tahap: readonly RingkasTahap[]): number {
  return tahap.reduce((sum, t) => sum + t.sisa, 0);
}

export type SaldoUangMuka = { amount: number; applied: number; status: string };

/** Sisa uang muka pemilik yang masih bisa dipakai. */
export function saldoUangMuka(rows: readonly SaldoUangMuka[]): number {
  return rows
    .filter((r) => r.status === "aktif")
    .reduce((sum, r) => sum + Math.max(0, (Number(r.amount) || 0) - (Number(r.applied) || 0)), 0);
}

export type BagianBayar = { method: string; amount: number };
export type AlokasiBaris = { invoiceId: string; invoiceNo: string | null; method: string; amount: number };
export type Alokasi = { baris: AlokasiBaris[]; uangMuka: number };

/**
 * Pratinjau alokasi satu kwitansi: tahap tertua lebih dulu (atau tagihan yang dipilih
 * kasir), bagian metode dipakai berurutan, sisanya jadi uang muka.
 *
 * Urutan dan pemotongannya sengaja identik dengan loop di clinic_receive_visit_payment.
 */
export function alokasiPembayaran(
  tahap: readonly RingkasTahap[],
  bagian: readonly BagianBayar[],
  invoiceDipilih?: string | null,
): Alokasi {
  const sisaBagian = bagian.map((b) => ({ ...b, sisa: Math.max(0, Number(b.amount) || 0) }));
  const urut = tahap
    .filter((t) => t.sisa > 0 && t.paid_status !== "Lunas" && !t.correction_pending)
    .slice()
    .sort((a, b) =>
      Number(b.id === invoiceDipilih) - Number(a.id === invoiceDipilih)
      || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const baris: AlokasiBaris[] = [];
  for (const t of urut) {
    let sisa = t.sisa;
    for (const part of sisaBagian) {
      if (sisa <= 0) break;
      const ambil = Math.min(part.sisa, sisa);
      if (ambil <= 0) continue;
      baris.push({ invoiceId: t.id, invoiceNo: t.invoice_no, method: part.method, amount: ambil });
      part.sisa -= ambil;
      sisa -= ambil;
    }
  }
  return { baris, uangMuka: sisaBagian.reduce((sum, p) => sum + p.sisa, 0) };
}

/** Uang muka yang akan terpakai otomatis saat tahap berikutnya diposting. */
export function uangMukaTerpakai(saldo: number, totalTahap: number): number {
  return Math.max(0, Math.min(Math.max(0, saldo), Math.max(0, totalTahap)));
}

// --- Bayangan jurnal ------------------------------------------------------------
// Jurnalnya ditulis database; bentuk yang sama ditiru di sini supaya bisa diperiksa
// keseimbangannya di uji unit dan ditampilkan ke keuangan tanpa membuka buku besar.
export type BarisJurnal = { code: string; debit: number; credit: number };

export function jurnalTerimaPembayaran(kasCode: string, amount: number): BarisJurnal[] {
  return [
    { code: kasCode, debit: amount, credit: 0 },
    { code: AKUN_PIUTANG_USAHA, debit: 0, credit: amount },
  ];
}

export function jurnalUangMukaMasuk(bagian: readonly { kasCode: string; amount: number }[]): BarisJurnal[] {
  const total = bagian.reduce((sum, b) => sum + b.amount, 0);
  return [
    ...bagian.map((b) => ({ code: b.kasCode, debit: b.amount, credit: 0 })),
    { code: AKUN_UANG_MUKA_JUAL, debit: 0, credit: total },
  ];
}

export function jurnalPakaiUangMuka(amount: number): BarisJurnal[] {
  return [
    { code: AKUN_UANG_MUKA_JUAL, debit: amount, credit: 0 },
    { code: AKUN_PIUTANG_USAHA, debit: 0, credit: amount },
  ];
}

export function jurnalBatalPembayaran(kasCode: string, amount: number): BarisJurnal[] {
  return [
    { code: AKUN_PIUTANG_USAHA, debit: amount, credit: 0 },
    { code: kasCode, debit: 0, credit: amount },
  ];
}

export function jurnalSeimbang(lines: readonly BarisJurnal[]): boolean {
  const debit = lines.reduce((sum, l) => sum + l.debit, 0);
  const credit = lines.reduce((sum, l) => sum + l.credit, 0);
  return Math.round(debit * 100) === Math.round(credit * 100);
}
