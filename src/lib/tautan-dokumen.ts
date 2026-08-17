// Satu pintu untuk semua nomor dokumen (permintaan Bu Nisa, meeting 14 Agustus:
// "nomor dokumen bisa diklik di mana pun, seperti Accurate").
//
// Masalahnya: yang tercetak di laporan & jurnal itu NOMOR-nya, sedangkan halaman
// dokumen dibuka pakai id. Daripada tiap layar mencari sendiri ke tabelnya, semua
// nomor menunjuk ke /dokumen/<nomor> — halaman itu yang mencari lalu melempar ke
// dokumen aslinya.

/** Tempat mencari satu nomor: tabel, kolom nomornya, dan ke mana harus dilempar. */
export type PetaDokumen = {
  tabel: string;
  kolom: string;
  /** Dibentuk dari id baris yang ketemu. */
  href: (row: { id: string; extra?: string | null }) => string;
  /** Kolom tambahan yang perlu ikut dibaca untuk menyusun href. */
  extra?: string;
  label: string;
};

export const PETA_DOKUMEN: PetaDokumen[] = [
  { tabel: "sales", kolom: "no_struk", label: "Struk kasir", href: (r) => `/penjualan/${r.id}` },
  { tabel: "sales_invoices", kolom: "no_faktur", label: "Faktur penjualan", href: () => `/penjualan/faktur` },
  { tabel: "sales_orders", kolom: "no_pesanan", label: "Pesanan penjualan", href: (r) => `/penjualan/pesanan/${r.id}` },
  { tabel: "sales_quotations", kolom: "no_penawaran", label: "Penawaran", href: () => `/penjualan/penawaran` },
  { tabel: "sales_deliveries", kolom: "no_kirim", label: "Pengiriman", href: () => `/penjualan/pengiriman` },
  { tabel: "sales_returns", kolom: "no_retur", label: "Retur penjualan", href: () => `/penjualan/retur` },
  { tabel: "sales_advances", kolom: "no_um", label: "Uang muka penjualan", href: () => `/penjualan/uang-muka` },
  { tabel: "purchase_orders", kolom: "no_po", label: "Pesanan pembelian", href: (r) => `/pembelian/${r.id}` },
  { tabel: "purchase_invoices", kolom: "no_faktur", label: "Faktur pembelian", href: () => `/pembelian/faktur` },
  { tabel: "purchase_returns", kolom: "no_retur", label: "Retur pembelian", href: () => `/pembelian/retur` },
  { tabel: "goods_receipts", kolom: "no_terima", label: "Penerimaan barang", href: () => `/pembelian/penerimaan` },
  { tabel: "opname_orders", kolom: "no_opname", label: "Perintah opname", href: (r) => `/pos/opname/${r.id}` },
  {
    tabel: "opname_results", kolom: "no_hasil", label: "Hasil opname",
    extra: "order_id", href: (r) => `/pos/opname/${r.extra ?? ""}`,
  },
  { tabel: "cash_entries", kolom: "no_bukti", label: "Kas masuk/keluar", href: () => `/kas-bank/kas-keluar` },
  { tabel: "invoices", kolom: "invoice_no", label: "Invoice klinik", extra: "visit_id", href: (r) => `/klinik/pembayaran/${r.extra ?? ""}/invoice` },
  { tabel: "journal_entries", kolom: "no_jurnal", label: "Jurnal", href: () => `/keuangan/jurnal` },
];

/** Halaman satu pintu untuk sebuah nomor dokumen. */
export const hrefDokumen = (nomor: string): string => `/dokumen/${encodeURIComponent(nomor.trim())}`;

/**
 * Nomor dokumen atau bukan?
 *
 * Dipakai supaya keterangan bebas ("bayar listrik") tidak ikut jadi tautan.
 * Pola nomor VetOS selalu HURUF + pemisah + angka, mis. FJ.2026.08.00001,
 * OPO.00385, JRN-202608-0091, POS-20260814-0003.
 */
export function tampakNomorDokumen(teks: string): boolean {
  return /^[A-Z]{2,4}[.\-/][A-Za-z0-9.\-/]*\d{3,}$/.test(teks.trim());
}
