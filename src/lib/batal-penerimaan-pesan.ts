/** "Batalkan penerimaan" klinik (gaya Accurate): pesan galat dan ringkasan pratinjau dalam bahasa Indonesia sederhana.
 *  Kode di awal pesan RPC (mis. "BATAL_PENERIMAAN_SUDAH_REFUND: ...") sudah membawa kalimat yang dimengerti Owner; di sini hanya
 *  dibersihkan dan dilengkapi untuk galat teknis. */
const PESAN: Record<string, string> = {
  ACCESS_DENIED: "Hanya Owner (atau peran yang diberi izin \"Batalkan penerimaan\" di Akses Grup) yang boleh membatalkan penerimaan pada cabang ini.",
  RECEIPT_INVALID: "Alasan wajib diisi (3 sampai 500 huruf).",
  IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dipakai untuk pembatalan lain. Muat ulang halaman lalu coba lagi.",
  AUDIT_IMMUTABLE: "Jejak pembatalan tidak dapat diubah.",
  BACKDATE_TIDAK_ADA: "Tagihan ini tidak sedang memakai tanggal efektif.",
  JOURNAL_UNBALANCED: "Jurnal pembatalan tidak seimbang, jadi tidak ada yang diubah. Hubungi tim pengembang.",
  ACCOUNT_INVALID: "Rekening pembayaran tidak aktif atau tidak ditemukan, jadi tidak ada yang diubah. Hubungi Finance.",
};

export const PESAN_BELUM_TERKONFIRMASI = "Pembatalan belum terkonfirmasi. Periksa status tagihan sebelum mencoba lagi; tidak ada yang diulang otomatis.";

export function pesanBatalPenerimaan(raw: string | null | undefined): string {
  const text = String(raw ?? "").trim();
  const dbRefusal = /^BATAL_PENERIMAAN_[A-Z_]+:\s*([\s\S]+)$/.exec(text);
  if (dbRefusal) return dbRefusal[1].trim();
  const periode = /^PERIODE_TERKUNCI:\s*([\s\S]+)$/.exec(text);
  if (periode) return /Tutup Buku/.test(periode[1]) ? periode[1].trim() : periode[1].trim() + ". Hubungi Finance untuk membuka periode.";
  if (/sudah ditutup — jurnal terkunci/.test(text)) return "Periode akuntansi sudah ditutup; pembalikan hari ini tidak bisa dibukukan. Hubungi Finance.";
  const code = /^([A-Z_]{4,40}):/.exec(text)?.[1];
  if (code && PESAN[code]) return PESAN[code];
  if (/lock timeout|55P03|40P01|deadlock/i.test(text)) return "Tagihan sedang dipakai kasir lain. Tunggu sebentar lalu coba lagi.";
  if (/permission denied|42501/i.test(text)) return PESAN.ACCESS_DENIED;
  return PESAN_BELUM_TERKONFIRMASI;
}

export type ShiftMode = "nonkas" | "shift_asal_terbuka" | "shift_berjalan" | "tanpa_shift";
export type PratinjauBatal = {
  refuse: { code: string; message: string } | null;
  invoice: { id: string; no: string | null; total: number; paid_status: string; metode_bayar: string | null; dp_amount: number; shift_id: string | null; visit_id: string; branch_id: string | null };
  direct: { amount: number; kas_code: string; metode: string | null } | null;
  payments: { id: string; amount: number; metode: string; kas_code: string; checkout: boolean }[];
  apps: { application_id: string; advance_id: string; advance_no: string; amount: number }[];
  receipts: { id: string; no: string; total: number; tanggal: string; parts: { metode: string; amount: number; kas_code: string }[];
    other_invoices: { invoice_id: string; no: string; amount: number }[]; advance: { no: string; amount: number } | null }[];
  actor: string; cash_amount: number; shift_mode: ShiftMode; today: string;
  /** Tanggal efektif (backdate): batas, hak memilih tanggal mundur, alasan tanggal terpilih ditolak, dan jendela yang sedang terbuka. */
  min_date?: string | null; max_date?: string; can_backdate?: boolean; effective_date?: string;
  date_refuse?: { code: string; message: string } | null; window?: { effective_date: string; opened_at: string } | null;
};
export type HasilBatal = {
  status: "CANCELLED"; cancellation_id: string; invoice_id: string; invoice_no: string; paid_status: string; amount: number; direct_amount: number;
  cash_amount: number; shift_mode: ShiftMode; receipts: string[]; other_invoices_unpaid: string[]; applications_released: number; tanggal: string;
  effective_date?: string; actual_date?: string; backdated?: boolean;
};

const rp = (n: number) => "Rp " + Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });
export const labelRekening = (code: string) => (code === "110003" ? "Kas (laci)" : code === "314001" ? "Uang muka pasien" : code === "120002" ? "Bank" : `Rekening ${code}`);

export const SHIFT_TEKS: Record<ShiftMode, string> = {
  nonkas: "Tidak ada uang tunai di laci yang terpengaruh.",
  shift_asal_terbuka: "Shift asal tagihan masih terbuka: pengurangan uang tunai otomatis tercatat di shift itu.",
  shift_berjalan: "Shift asal tagihan sudah ditutup (rekamannya TIDAK diubah). Pengurangan uang tunai dicatat di shift Anda yang sedang terbuka.",
  tanpa_shift: "Shift asal sudah ditutup dan Anda tidak punya shift terbuka. Pembatalan tetap berjalan; pengurangan uang tunai ditandai \"tanpa shift\" untuk disesuaikan Finance.",
};

/** Daftar kalimat \"apa yang akan terjadi\" untuk layar konfirmasi. */
export function ringkasanPratinjau(p: PratinjauBatal, tanggal?: string | null): string[] {
  const out: string[] = [];
  if (p.direct) out.push(`Penerimaan langsung ${rp(p.direct.amount)} (${p.direct.metode ?? "-"}) dikeluarkan dari ${labelRekening(p.direct.kas_code)}; piutang tagihan kembali.`);
  for (const a of p.apps) out.push(`Pemakaian uang muka ${a.advance_no} ${rp(a.amount)} dibatalkan: jumlahnya kembali ke saldo uang muka pasien (uang bank tidak bergerak).`);
  for (const x of p.payments) out.push(`Pembayaran ${x.metode} ${rp(x.amount)} dikeluarkan dari ${labelRekening(x.kas_code)}.`);
  for (const k of p.receipts) {
    out.push(`Kwitansi ${k.no} (${rp(k.total)}: ${k.parts.map((x) => `${x.metode} ${rp(x.amount)}`).join(", ")}) dibatalkan utuh.`);
    if (k.other_invoices.length) out.push(`Kwitansi ${k.no} juga melunasi tagihan ${k.other_invoices.map((o) => o.no).join(", ")}: tagihan itu ikut kembali Belum Lunas.`);
    if (k.advance) out.push(`Uang muka ${k.advance.no} (${rp(k.advance.amount)}) dari kwitansi ini ikut dibatalkan karena belum terpakai.`);
  }
  const mundur = !!tanggal && tanggal < p.today;
  out.push(`Tagihan ${p.invoice.no ?? ""} kembali Belum Lunas dengan nomor yang sama; stok, HPP, dan jurnal penjualan TIDAK berubah. Jurnal pembalik bertanggal ${mundur ? tanggal : p.today}.`);
  out.push(SHIFT_TEKS[p.shift_mode]);
  if (mundur) out.push(...ringkasanTanggalMundur(tanggal as string, p.today));
  return out;
}

/** Apa yang ikut tanggal efektif dan apa yang tetap HARI INI (dipakai pratinjau dan hasil). */
export function ringkasanTanggalMundur(efektif: string, hariIni: string): string[] {
  return [
    `Tanggal efektif ${efektif} (bukan hari ini, ${hariIni}): jurnal pembalik, baris pembayaran pembalik, lalu koreksi tagihan dan penerimaan ulang berikutnya dibukukan pada tanggal ${efektif}, jadi omzet dan penerimaan hari itu ikut berubah. Jurnal dan buku besar mencatat tanggal ${efektif} sekaligus waktu pencatatan sebenarnya (${hariIni}).`,
    `Tetap HARI INI: uang tunai/QRIS fisik di laci shift (shift Anda yang sedang terbuka), waktu dan pelaku pencatatan, serta gerakan stok. Shift lama yang sudah ditutup tidak diubah.`,
    `Berlaku sampai tagihan ini Lunas lagi atau Owner melepas tanggal efektif di halaman tagihan. Jika periode akuntansi/persediaan atau penggajian untuk tanggal itu sudah ditutup, sistem menolak (tidak dilewati).`,
  ];
}

export function ringkasanHasil(h: HasilBatal): string[] {
  const out = [`Penerimaan ${rp(h.amount)} pada ${h.invoice_no} dibatalkan. Status tagihan sekarang ${h.paid_status}.`];
  if (h.receipts.length) out.push(`Kwitansi dibatalkan: ${h.receipts.join(", ")}.`);
  if (h.other_invoices_unpaid.length) out.push(`Tagihan lain yang ikut kembali Belum Lunas: ${h.other_invoices_unpaid.join(", ")}.`);
  if (h.applications_released > 0) out.push("Uang muka yang dipakai kembali ke saldo uang muka pasien.");
  out.push(SHIFT_TEKS[h.shift_mode]);
  if (h.backdated && h.effective_date) {
    out.push(`Dibukukan pada tanggal efektif ${h.effective_date} (dicatat sebenarnya ${h.actual_date ?? "hari ini"}). Ubah tagihan dan terima pembayaran lagi: keduanya otomatis bertanggal ${h.effective_date}; uang fisik tetap masuk shift Anda hari ini.`);
  }
  return out;
}
