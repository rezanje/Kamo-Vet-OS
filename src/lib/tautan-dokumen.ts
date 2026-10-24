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
  { tabel: "sales_invoices", kolom: "no_faktur", label: "Faktur penjualan", href: (r) => `/penjualan/faktur/${r.id}` },
  { tabel: "sales_receipts", kolom: "no_terima", label: "Penerimaan penjualan",
    extra: "invoice_id", href: (r) => `/penjualan/faktur/${r.extra ?? ""}#receipt-${r.id}` },
  { tabel: "sales_orders", kolom: "no_pesanan", label: "Pesanan penjualan", href: (r) => `/penjualan/pesanan/${r.id}` },
  { tabel: "sales_quotations", kolom: "no_penawaran", label: "Penawaran",
    href: (r) => `/penjualan/penawaran?quotation=${r.id}#quotation-${r.id}` },
  { tabel: "sales_deliveries", kolom: "no_kirim", label: "Pengiriman",
    href: (r) => `/penjualan/pengiriman?delivery=${r.id}#delivery-${r.id}` },
  { tabel: "sales_returns", kolom: "no_retur", label: "Retur penjualan", href: (r) => `/penjualan/retur/${r.id}` },
  { tabel: "sales_advances", kolom: "no_um", label: "Uang muka penjualan", href: (r) => `/penjualan/uang-muka#advance-${r.id}` },
  { tabel: "purchase_advances", kolom: "no_um", label: "Uang muka pembelian", href: (r) => `/pembelian/uang-muka#advance-${r.id}` },
  { tabel: "purchase_orders", kolom: "no_po", label: "Pesanan pembelian", href: (r) => `/pembelian/${r.id}` },
  { tabel: "payment_orders", kolom: "no_pp", label: "Perintah bayar",
    href: (r) => `/pembelian/perintah-bayar?order=${r.id}#payment-order-${r.id}` },
  { tabel: "purchase_invoices", kolom: "no_faktur", label: "Faktur pembelian", href: (r) => `/pembelian/faktur/${r.id}` },
  { tabel: "purchase_returns", kolom: "no_retur", label: "Retur pembelian", href: (r) => `/pembelian/retur/${r.id}` },
  { tabel: "goods_receipts", kolom: "no_terima", label: "Penerimaan barang", href: (r) => `/pembelian/penerimaan/${r.id}` },
  { tabel: "opname_orders", kolom: "no_opname", label: "Perintah opname", href: (r) => `/pos/opname/${r.id}` },
  {
    tabel: "opname_results", kolom: "no_hasil", label: "Hasil opname",
    extra: "order_id", href: (r) => `/pos/opname/${r.extra ?? ""}`,
  },
  { tabel: "cash_entries", kolom: "no_bukti", label: "Kas masuk/keluar",
    extra: "jenis", href: (r) => r.extra === "Masuk" || r.extra === "Keluar"
      ? `/kas-bank/kas-${r.extra.toLowerCase()}?entry=${r.id}#cash-entry-${r.id}` : "/kas-bank" },
  { tabel: "invoices", kolom: "invoice_no", label: "Invoice klinik", extra: "visit_id", href: (r) => `/klinik/pembayaran/${r.extra ?? ""}/invoice` },
  { tabel: "journal_entries", kolom: "no_jurnal", label: "Jurnal",
    href: (r) => `/keuangan/jurnal?entry=${r.id}#journal-${r.id}` },
];

/** Halaman satu pintu untuk sebuah nomor dokumen. */
export const hrefDokumen = (nomor: string): string => `/dokumen/${encodeURIComponent(nomor.trim())}`;

// Bukti kas dan jurnal punya layar modul sendiri. Tautan langsung ini menjaga
// akses FINANCE yang sudah ada tanpa membuka resolver lintas modul `/dokumen`.
export function hrefNomorModul(nomor: string): string | null {
  const value = nomor.trim();
  if (/^KM[.\-/]/.test(value)) return `/kas-bank/kas-masuk?bukti=${encodeURIComponent(value)}#selected-cash-entry`;
  if (/^KK[.\-/]/.test(value)) return `/kas-bank/kas-keluar?bukti=${encodeURIComponent(value)}#selected-cash-entry`;
  if (/^JRN[.\-/]/.test(value)) return `/keuangan/jurnal?nomor=${encodeURIComponent(value)}#selected-journal`;
  return null;
}

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
