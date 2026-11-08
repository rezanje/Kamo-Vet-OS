/** Owner: ubah BMHP (bahan habis pakai) baris tindakan rawat inap.
 *  Bagian A = baris masih di keranjang kasir (belum ditagih); bagian B = baris sudah ada di invoice (lunas atau belum).
 *  Kode di awal pesan RPC (mis. "BMHP_LIMIT: ...") dipetakan ke kalimat sederhana; pesan tak dikenal tidak pernah ditampilkan mentah. */
const PESAN: Record<string, string> = {
  ACCESS_DENIED: "Hanya Owner (cabang ini) yang boleh mengubah BMHP tindakan.",
  REASON_REQUIRED: "Alasan wajib diisi (minimal 5 huruf, maksimal 500).",
  CART_STALE: "Keranjang sudah berubah sejak halaman dibuka. Muat ulang halaman lalu ulangi.",
  SHIFT_INVALID: "Shift kasir belum dibuka atau sudah tidak berlaku. Buka shift lalu ulangi.",
  BMHP_LIMIT: "Jumlah bahan melebihi batas wajar (maksimal 10× bawaan tindakan, bahan baru maksimal 1000).",
  NO_CHANGE: "Tidak ada perubahan dari daftar bahan saat ini.",
  IDEMPOTENCY_CONFLICT: "Permintaan dengan kunci yang sama sudah dipakai untuk perubahan lain. Muat ulang halaman.",
  LINE_INVALID: "Baris tidak ditemukan atau sudah ditarik dari penagihan.",
  NOT_BMHP: "Baris ini tidak punya rincian BMHP.",
  RECIPE_LINKED: "Baris racikan dikoreksi lewat koreksi racikan, bukan di sini.",
  NOT_INPATIENT: "Hanya untuk tagihan rawat inap.",
  INVOICE_VOID: "Tagihan ini sudah dibatalkan.",
  INVOICE_PENDING: "Tagihan sedang menunggu koreksi kasir.",
  INVOICE_ADJUSTED: "Tagihan ini hasil terbit ulang atau bukan tagihan tahap rawat inap. Belum didukung.",
  REFUND_EXISTS: "Tagihan ini sudah punya refund atau permintaan refund.",
  VISIT_CLOSED: "Kunjungan sudah selesai, check-out, atau diarsipkan.",
  AVERAGE_UNSUPPORTED: "Metode persediaan rata-rata belum didukung untuk koreksi ini.",
  STOCK_SHORT: "Stok bahan tidak mencukupi untuk tambahan jumlah ini.",
  STOCK_MISMATCH: "Kartu stok tagihan tidak cocok dengan rincian baris, jadi sistem tidak menebak. Hubungi Reza.",
  JOURNAL_MISMATCH: "Jurnal HPP tagihan tidak cocok dengan HPP baris, jadi sistem tidak menebak. Hubungi Reza.",
  HPP_INCONSISTENT: "HPP baris tidak cocok dengan rincian bahannya, jadi sistem tidak menebak. Hubungi Reza.",
  COST_MISSING: "Perubahan ini membuat HPP baris nol atau negatif. Tidak diizinkan.",
  PERIOD_LOCKED: "Periode akuntansi atau persediaan sudah ditutup.",
};

export function pesanBmhpOwner(raw: string | null | undefined): string {
  const text = String(raw ?? "").trim();
  const code = /^([A-Z_]{4,40}):/.exec(text)?.[1];
  const detail = code ? text.slice(code.length + 1).trim().split("\n")[0].slice(0, 220) : "";
  if (code === "BMHP_INVALID") return detail ? `Daftar bahan tidak valid: ${detail}` : "Daftar bahan tidak valid.";
  if (code && PESAN[code]) return PESAN[code];
  if (/Periode (akuntansi|persediaan)/.test(text)) return PESAN.PERIOD_LOCKED;
  if (/lock timeout|55P03|40P01|deadlock/i.test(text)) return "Tagihan sedang dipakai kasir lain. Tunggu sebentar lalu coba lagi.";
  if (/permission denied|42501/i.test(text)) return PESAN.ACCESS_DENIED;
  return "Perubahan belum terkonfirmasi. Periksa tagihan sebelum mencoba lagi; tidak ada yang diulang otomatis.";
}

export type KomponenBmhp = { item_id: string; name?: string; qty: number | string; unit?: string | null; factor?: number | null; base_qty?: number | null; cost?: number | null };
export type KomponenInput = { item_id: string; qty: string; unit?: string | null };

/** Dari baris form ke muatan RPC: jumlah kosong atau 0 = bahan dikeluarkan dari daftar. Titik atau koma desimal diterima. */
export function muatanKomponen(rows: KomponenInput[]): { ok: true; components: { item_id: string; qty: number; unit?: string }[] } | { ok: false; pesan: string } {
  const out: { item_id: string; qty: number; unit?: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const raw = String(row.qty ?? "").trim().replace(",", ".");
    if (raw === "" || (/^\d+(\.\d*)?$/.test(raw) && Number(raw) === 0)) continue;
    if (!/^\d+(\.\d{1,4})?$/.test(raw)) return { ok: false, pesan: "Jumlah bahan harus angka positif, maksimal 4 desimal." };
    if (seen.has(row.item_id)) return { ok: false, pesan: "Satu bahan tidak boleh muncul dua kali." };
    seen.add(row.item_id);
    out.push({ item_id: row.item_id, qty: Number(raw), ...(row.unit ? { unit: row.unit } : {}) });
  }
  if (out.length === 0) return { ok: false, pesan: "Minimal satu bahan harus tersisa." };
  return { ok: true, components: out };
}

export type PratinjauBmhp = {
  item_name?: string; hpp_before: number; hpp_after: number; cost_before?: number; cost_after?: number; hpp_delta?: number;
  price: number; net_price?: number; floor_applies: boolean; price_below_hpp_before: boolean | null; price_below_hpp_after: boolean | null;
  can_post_after?: boolean; can_post_before?: boolean; sim_error_after?: string | null;
  invoice_no?: string; paid_status?: string; hpp_differs_from_cost?: boolean;
  journal?: { date: string; lines: { code: string; debit: number; credit: number }[] };
  stock?: { name?: string; direction: string; delta: number; cost?: number }[];
  snapshot_after?: string;
};
