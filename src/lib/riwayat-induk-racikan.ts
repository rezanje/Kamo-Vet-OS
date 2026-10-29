import { ListLoadError, readCompleteList } from "@/lib/checked-list";
import { hrefInvoiceKlinik } from "@/lib/tautan-dokumen";

// I09 lanjutan: riwayat SKU induk racikan nonstok — "kartu stok" virtual.
// Masuk = racikan dibuat untuk SKU ini; Keluar = racikan itu ditagih di invoice klinik.
// Induknya tetap tanpa stok fisik dan tanpa harga; semuanya dibaca lewat satu RPC baca-saja.
// Baris cabang lain tetap dihitung, nomornya tampil tanpa tautan (tanpa nama pasien/pelanggan).

export type RiwayatRacikanBaris = {
  id: string;
  arah: "masuk" | "keluar";
  waktu: string;
  tanggal: string;
  qty: number;
  satuan: string;
  nomorRacikan: string;
  recipeId: string | null;
  namaRacikan: string | null;
  statusRacikan: string;
  sumber: string;
  visitId: string | null;
  pasien: string | null;
  pelanggan: string | null;
  cabang: string | null;
  invoiceId: string | null;
  nomorInvoice: string | null;
  invoiceBatal: boolean;
  bisaDibuka: boolean;
};

type Raw = Record<string, unknown>;
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const optStr = (v: unknown): v is string | null => v === null || v === undefined || typeof v === "string";
const angka = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

function tidakValid(): never {
  throw new ListLoadError("Riwayat racikan tidak valid. Coba muat ulang.");
}

/** Satu baris RPC → baris layar. Bentuk yang tidak dikenal ditolak, bukan ditebak. */
export function parseRiwayatRacikanBaris(row: unknown): RiwayatRacikanBaris & { total: number } {
  if (!row || typeof row !== "object" || Array.isArray(row)) tidakValid();
  const r = row as Raw;
  const qty = angka(r.qty);
  const total = angka(r.total_baris);
  if (!str(r.id) || (r.arah !== "masuk" && r.arah !== "keluar") || !str(r.waktu) || !str(r.tanggal)
    || qty === null || total === null || !Number.isSafeInteger(total) || total < 0
    || !str(r.satuan) || !str(r.nomor_racikan) || !str(r.status_racikan) || !str(r.sumber)
    || typeof r.bisa_dibuka !== "boolean"
    || !optStr(r.recipe_id) || !optStr(r.nama_racikan) || !optStr(r.visit_id) || !optStr(r.pasien)
    || !optStr(r.pelanggan) || !optStr(r.cabang) || !optStr(r.invoice_id) || !optStr(r.nomor_invoice)
    || !(r.invoice_batal === null || r.invoice_batal === undefined || typeof r.invoice_batal === "boolean")) tidakValid();
  // Keluar selalu menunjuk invoice; Masuk tidak pernah.
  if (r.arah === "keluar" ? !str(r.nomor_invoice) && !str(r.invoice_id) : r.invoice_id != null) tidakValid();
  // Tanpa akses cabang, database tidak boleh mengirim tautan atau nama.
  if (!r.bisa_dibuka && (r.recipe_id != null || r.visit_id != null || r.invoice_id != null || r.pasien != null || r.pelanggan != null)) tidakValid();
  return {
    id: r.id, arah: r.arah, waktu: r.waktu, tanggal: r.tanggal, qty, satuan: r.satuan,
    nomorRacikan: r.nomor_racikan, recipeId: (r.recipe_id as string | null) ?? null,
    namaRacikan: (r.nama_racikan as string | null) ?? null, statusRacikan: r.status_racikan, sumber: r.sumber,
    visitId: (r.visit_id as string | null) ?? null, pasien: (r.pasien as string | null) ?? null,
    pelanggan: (r.pelanggan as string | null) ?? null, cabang: (r.cabang as string | null) ?? null,
    invoiceId: (r.invoice_id as string | null) ?? null, nomorInvoice: (r.nomor_invoice as string | null) ?? null,
    invoiceBatal: r.invoice_batal === true, bisaDibuka: r.bisa_dibuka, total,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/**
 * Seluruh riwayat dalam rentang, dibaca per halaman dan diverifikasi jumlahnya seperti kartu stok:
 * jumlah dari halaman pertama mengunci halaman berikutnya, tidak pernah menampilkan sebagian.
 */
export async function readRiwayatIndukRacikan(supabase: AnyClient, itemId: string, dari: string, sampai: string): Promise<RiwayatRacikanBaris[]> {
  let ditolak = false;
  const rows = await readCompleteList<RiwayatRacikanBaris & { total: number }>(async (from, to) => {
    const { data, error } = await supabase.rpc("read_compound_parent_history", {
      p_item_id: itemId, p_dari: dari, p_sampai: sampai, p_offset: from, p_limit: to - from + 1,
    });
    if (error) {
      if (error.code === "42501") ditolak = true;
      return { data: null, count: null, error };
    }
    if (!Array.isArray(data)) return { data: null, count: null, error: "bentuk data" };
    const parsed = data.map(parseRiwayatRacikanBaris);
    const totals = new Set(parsed.map((row) => row.total));
    if (totals.size > 1) return { data: null, count: null, error: "jumlah berbeda" };
    // Halaman kosong di awal = memang kosong; di tengah = jumlah tidak dapat diverifikasi.
    const count = parsed.length ? parsed[0].total : from === 0 ? 0 : null;
    return { data: parsed, count, error: null };
  }, "Riwayat racikan", { maxRows: null }).catch((error: unknown) => {
    if (ditolak) throw new ListLoadError("Anda tidak punya akses ke riwayat racikan ini.");
    throw error;
  });
  return rows.map((row) => {
    const copy: Partial<typeof row> = { ...row };
    delete copy.total;
    return copy as RiwayatRacikanBaris;
  });
}

export type RingkasanRiwayat = { dibuat: number; ditagih: number; racikanVoid: number; invoiceBatal: number };

/** Racikan void dan invoice batal tetap tampil di daftar, tetapi tidak dihitung. */
export function ringkasRiwayat(rows: RiwayatRacikanBaris[]): RingkasanRiwayat {
  const r: RingkasanRiwayat = { dibuat: 0, ditagih: 0, racikanVoid: 0, invoiceBatal: 0 };
  for (const row of rows) {
    if (row.arah === "masuk") {
      if (row.statusRacikan === "void") r.racikanVoid += row.qty; else r.dibuat += row.qty;
    } else if (row.invoiceBatal) r.invoiceBatal += row.qty;
    else r.ditagih += row.qty;
  }
  return r;
}

export const hrefRiwayatIndukRacikan = (itemId: string, opts: { dari?: string; sampai?: string } = {}) => {
  const q = new URLSearchParams();
  if (opts.dari) q.set("dari", opts.dari);
  if (opts.sampai) q.set("sampai", opts.sampai);
  const qs = q.toString();
  return `/pos/sku/${encodeURIComponent(itemId)}/riwayat-racikan${qs ? `?${qs}` : ""}`;
};

/** Tautan baris — hanya bila database menyatakan cabangnya bisa dibuka. */
export function tautanBaris(row: RiwayatRacikanBaris) {
  if (!row.bisaDibuka) return { racikan: null, kunjungan: null, invoice: null };
  return {
    racikan: row.recipeId ? `/klinik/racik/${encodeURIComponent(row.recipeId)}` : null,
    kunjungan: row.visitId ? `/klinik/rekam-medis/${encodeURIComponent(row.visitId)}` : null,
    invoice: row.visitId && row.invoiceId ? hrefInvoiceKlinik(row.visitId, row.invoiceId) : null,
  };
}

const KATEGORI_RACIKAN = new Set(["OBAT RACIK", "OBAT RACIKAN", "RACIKAN"]);

/**
 * Aturan "SKU obat racik" yang sama dengan database (clinic_private.is_racikan_sku, dipakai juga
 * saat racikan dibuat): nama "Obat Racik …"/"Obat Racikan …" atau langsung berkategori Racikan.
 */
export function adalahIndukRacikan(
  item: { name: string; item_type: string; category_id: string | null },
  categories: { id: string; name: string }[],
): boolean {
  if (item.item_type !== "Persediaan") return false;
  if (/^obat racik(an)? /i.test(item.name)) return true;
  const kategori = categories.find((c) => c.id === item.category_id);
  return !!kategori && KATEGORI_RACIKAN.has(kategori.name.trim().replace(/\s+/g, " ").toUpperCase());
}
