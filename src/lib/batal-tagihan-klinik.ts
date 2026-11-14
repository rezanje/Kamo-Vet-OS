/**
 * B2 (meeting 12 Nov 2026, keputusan Reza: A) — "Batalkan tagihan" klinik (void murni, tanpa tagihan pengganti) dan "Tutup kunjungan".
 * Satu tempat untuk aturan layar, pesan, dan ringkasan. Penegak sebenarnya ada di database (migrasi 20261118620000_b2_batalkan_tagihan_klinik.sql):
 * RPC clinic_void_invoice / clinic_void_invoice_preview / clinic_invoice_void_allowed / clinic_close_settled_visit memeriksa ulang semuanya.
 */

/** Izin Akses Grup (izin khusus, bawaan MATI untuk selain Owner). Harus sama dengan baris katalog di migrasi. */
export const IZIN_BATAL_TAGIHAN = "klinik.batalkan_tagihan";
export const ALASAN_BATAL_MIN = 3;
export const ALASAN_BATAL_MAX = 500;

export const PESAN_BATAL_BELUM_TERKONFIRMASI =
  "Pembatalan belum terkonfirmasi. Periksa status tagihan sebelum mencoba lagi; tidak ada yang diulang otomatis.";

const PESAN: Record<string, string> = {
  ACCESS_DENIED: "Hanya Owner (atau peran yang diberi izin \"Batalkan tagihan\" di Akses Grup) yang boleh membatalkan tagihan pada cabang ini.",
  BATAL_TAGIHAN_INVALID: `Alasan wajib diisi (${ALASAN_BATAL_MIN} sampai ${ALASAN_BATAL_MAX} huruf).`,
  IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dipakai untuk pembatalan lain. Muat ulang halaman lalu coba lagi.",
  JOURNAL_UNBALANCED: "Pembukuan pembatalan tidak seimbang, jadi tidak ada yang diubah. Hubungi tim pengembang.",
  AUDIT_IMMUTABLE: "Jejak pembatalan tidak dapat diubah.",
};

/** Galat RPC -> kalimat untuk Owner. Penolakan database ("BATAL_TAGIHAN_<KODE>: kalimat") sudah berbahasa biasa; kodenya dibuang. */
export function pesanBatalTagihan(raw: string | null | undefined): string {
  const text = String(raw ?? "").trim();
  const code = /^([A-Z_]{4,60}):/.exec(text)?.[1];
  if (code && PESAN[code]) return PESAN[code];
  const ditolak = /^BATAL_TAGIHAN_[A-Z_]+:\s*([\s\S]+)$/.exec(text);
  if (ditolak) return ditolak[1].trim();
  if (/sudah ditutup — jurnal terkunci|Periode akuntansi sampai/.test(text)) return "Periode akuntansi tanggal tagihan sudah ditutup. Owner perlu membuka kembali periodenya di Keuangan > Tutup Buku.";
  if (/lock timeout|55P03|40P01|deadlock/i.test(text)) return "Tagihan sedang dipakai kasir lain. Tunggu sebentar lalu coba lagi.";
  if (/permission denied|42501/i.test(text)) return PESAN.ACCESS_DENIED;
  return PESAN_BATAL_BELUM_TERKONFIRMASI;
}

export type PratinjauBatalTagihan = {
  refuse: { code: string; message: string } | null;
  invoice: { id: string; no: string | null; total: number; paid_status: string; dp_amount: number; visit_id: string; branch_id: string | null; voided_at: string | null };
  original_date: string; stock_date?: string; today: string; dp: number; points_net: number; stock_value: number; racik_value: number; hpp_reversed: number;
  stock_lines: number; racik_lines: number; withdraw_count: number; line_count: number; actor: "OWNER" | "GRANT";
};

export type HasilBatalTagihan = {
  status: "VOIDED"; void_id: string; invoice_id: string; invoice_no: string; visit_id: string; original_date: string; stock_date?: string; tanggal: string;
  total: number; dp_converted: number; advance_id: string | null; advance_no: string | null; stock_value: number; hpp_reversed: number;
  stock: { item_id: string; name: string | null; qty: number; cost: number; cara: string; racikan?: string }[];
  points_delta: number; withdrawn: number; replayed?: boolean;
};

const rp = (n: number) => "Rp " + Number(n).toLocaleString("id-ID", { maximumFractionDigits: 0 });
const tgl = (iso: string) => {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : String(iso);
};

/** Apa yang akan terjadi, dalam bahasa biasa (dari pratinjau database). */
export function ringkasanPratinjauBatalTagihan(p: PratinjauBatalTagihan): string[] {
  const no = p.invoice.no ?? "tagihan ini";
  const out = [`Tagihan ${no} (${rp(p.invoice.total)}) dibatalkan tanpa tagihan pengganti; nomornya tetap tercatat sebagai batal.`];
  out.push(`Omzet dan piutang dibalik di tanggal tagihan asli (${tgl(p.original_date)}).`);
  const nilaiStok = Number(p.stock_value) + Number(p.racik_value);
  // Aturan 2A (keputusan B3 A): stok fisik dan HPP kembali HARI INI.
  if (nilaiStok > 0) out.push(`Obat/bahan${p.racik_lines > 0 ? " dan bahan racikan" : ""} senilai ${rp(nilaiStok)} kembali ke stok hari ini (HPP-nya ikut dibalik hari ini).`);
  if (Number(p.dp) > 0) out.push(`DP ${rp(p.dp)} tidak hilang: jadi saldo uang muka pelanggan, bisa dikembalikan lewat "Kembalikan saldo uang muka".`);
  if (p.points_net > 0) out.push(`${p.points_net} poin dari tagihan ini ditarik kembali dari pelanggan.`);
  else if (p.points_net < 0) out.push(`${-p.points_net} poin yang dipakai di tagihan ini dikembalikan ke pelanggan.`);
  if (p.withdraw_count > 0) out.push("Obat/layanan di rekam medis tidak muncul lagi di kasir (isi rekam medis tetap ada).");
  out.push("Setelah itu kunjungan bisa diarsipkan lewat \"Paksa arsip\" di Antrian.");
  return out;
}

/** Ringkasan sesudah berhasil. */
export function ringkasanHasilBatalTagihan(h: HasilBatalTagihan): string[] {
  const out = [`Tagihan ${h.invoice_no} dibatalkan; omzet dan piutangnya dibalik di tanggal ${tgl(h.original_date)}.`];
  if (Number(h.stock_value) > 0) out.push(`Stok senilai ${rp(h.stock_value)} sudah kembali hari ini.`);
  if (Number(h.dp_converted) > 0) out.push(`DP ${rp(h.dp_converted)} sekarang jadi saldo uang muka${h.advance_no ? ` ${h.advance_no}` : ""} milik pelanggan.`);
  if (h.points_delta < 0) out.push(`${-h.points_delta} poin ditarik dari pelanggan.`);
  else if (h.points_delta > 0) out.push(`${h.points_delta} poin dikembalikan ke pelanggan.`);
  return out;
}

/** Tagihan yang ditawari tombol "Batalkan tagihan": sudah terbit, Belum Lunas / DP, bukan dalam koreksi, bukan rawat inap. Database memeriksa ulang. */
export function bolehTawarkanBatalTagihan(
  inv: { paid_status?: string | null; correction_pending?: boolean | null; voided_at?: string | null; invoice_no?: string | null } | null | undefined,
  rawatInap: boolean,
): boolean {
  return !!inv && !rawatInap && !inv.voided_at && !inv.correction_pending && !!inv.invoice_no
    && (inv.paid_status === "Belum Lunas" || inv.paid_status === "DP");
}

/** Pembacaan izin layar (pola Batalkan penerimaan): true/false dari database, null = gagal baca. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function bacaBolehBatalTagihan(supabase: any): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.rpc("clinic_invoice_void_allowed");
    if (!error) return data === true;
  } catch { /* gagal baca = tidak diketahui */ }
  return null;
}

/** Bila izin tak terbaca, Owner tetap melihat tombol (database memutuskan); peran lain tidak. */
export function putuskanBolehBatalTagihan(dibaca: boolean | null, role: string | null | undefined): boolean {
  return dibaca === null ? role === "OWNER" : dibaca;
}

// ───────────── Tutup kunjungan (Owner/Admin) ─────────────

export const PERAN_TUTUP_KUNJUNGAN = ["OWNER", "ADMIN"] as const;

export function bolehTutupKunjungan(profile: { role?: string | null; is_active?: boolean | null } | null | undefined): boolean {
  return !!profile?.is_active && (PERAN_TUTUP_KUNJUNGAN as readonly string[]).includes(profile.role ?? "");
}

type TagihanRingkas = { paid_status?: string | null; voided_at?: string | null; correction_pending?: boolean | null };

/** Tombol "Tutup kunjungan" hanya untuk kunjungan Pembayaran yang punya tagihan aktif dan semuanya Lunas. Database memeriksa sisanya. */
export function semuaTagihanLunas(invoices: TagihanRingkas[] | TagihanRingkas | null | undefined): boolean {
  const list = (Array.isArray(invoices) ? invoices : invoices ? [invoices] : []).filter((i) => !i.voided_at);
  return list.length > 0 && list.every((i) => i.paid_status === "Lunas" && !i.correction_pending);
}

/** Galat RPC tutup kunjungan -> kalimat tanpa kode teknis. */
export function pesanTutupKunjungan(raw: string | null | undefined): string {
  const text = String(raw ?? "").trim();
  if (/lock timeout|55P03/i.test(text)) return "Kunjungan sedang diproses pengguna lain. Tunggu sebentar lalu coba lagi.";
  if (/^ACCESS_DENIED/.test(text)) return "Hanya pemilik atau admin yang boleh menutup kunjungan.";
  const bersih = text.replace(/^\s*[A-Z][A-Z_]+:\s*/, "").trim();
  return bersih ? bersih.charAt(0).toUpperCase() + bersih.slice(1) : "Kunjungan belum bisa ditutup. Muat ulang halaman lalu coba lagi.";
}
