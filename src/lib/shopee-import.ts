// Impor pesanan Shopee (Seller Centre → Pesanan → Ekspor "Order.toship") — pembaca xlsx murni.
// Hanya membaca kolom yang dibutuhkan, lewat NAMA header (bukan huruf kolom) supaya pergeseran kolom
// tidak merusak impor. Data pribadi pembeli (nama penerima, telepon, alamat) sengaja TIDAK dibaca:
// pembeli = Username saja. Sheet lain (mis. "Advance Fulfilment") tidak disentuh.
import ExcelJS from "exceljs";

export const BATAS_FILE_SHOPEE = 5 * 1024 * 1024;
const BATAS_BARIS = 5000;

export type ShopeeLine = {
  /** Nomor baris di sheet (1 = header) untuk pesan kesalahan. */
  baris: number;
  skuInduk: string;
  skuRef: string;
  namaProduk: string;
  variasi: string;
  qty: number;
  hargaAwal: number;
  /** Harga Setelah Diskon per unit = harga yang benar-benar dibebankan ke pembeli. */
  harga: number;
  subtotal: number;
};

export type ShopeeRincian = {
  voucherPenjual: number;
  voucherShopee: number;
  koin: number;
  kartuKredit: number;
  ongkirPembeli: number;
  potonganOngkir: number;
  perkiraanOngkir: number;
};

export type ShopeeOrder = {
  orderNo: string;
  status: string;
  statusPembatalan: string;
  /** false = tidak diimpor secara bawaan (lihat skipReason). */
  importable: boolean;
  /** false = data rusak (jumlah/harga/tanggal): tidak boleh diimpor, bahkan oleh Owner. */
  dataValid: boolean;
  skipReason: string | null;
  /** YYYY-MM-DD (WIB) dari Waktu Pesanan Dibuat. */
  tanggal: string | null;
  /** Username pembeli di Shopee — satu-satunya data pembeli yang disimpan. */
  buyer: string;
  metodeBayar: string;
  lines: ShopeeLine[];
  /** Σ qty × Harga Setelah Diskon (yang dicatat sebagai total order). */
  subtotalBarang: number;
  totalPembayaran: number | null;
  rincian: ShopeeRincian;
  /** Total Pembayaran − (subtotal − voucher − koin − kartu kredit + ongkir pembeli); null bila total tidak ada. */
  selisih: number | null;
};

/** Angka format Indonesia ("20.912" = 20912, "1.234,50" = 1234,5). Teks bukan angka = NaN. */
export function parseShopeeNumber(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  if (raw == null) return 0;
  const s = String(raw).replace(/^\s*rp\.?\s*/i, "").replace(/\s+/g, "");
  if (s === "") return 0;
  if (!/^-?[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const dots = (body.match(/\./g) ?? []).length;
  const commas = (body.match(/,/g) ?? []).length;
  let num: string;
  if (commas > 1) return NaN;
  if (commas === 1) {
    const [int, frac] = body.split(",");
    // Titik sebelum koma harus pemisah ribuan yang rapi.
    if (dots > 0 && !/^\d{1,3}(\.\d{3})+$/.test(int)) return NaN;
    if (!/^\d+$/.test(frac)) return NaN;
    num = `${int.replace(/\./g, "")}.${frac}`;
  } else if (dots === 0) {
    num = body;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(body)) {
    num = body.replace(/\./g, "");
  } else if (dots === 1 && /^\d+\.\d+$/.test(body)) {
    num = body;
  } else return NaN;
  const value = Number(num);
  return Number.isFinite(value) ? (neg ? -value : value) : NaN;
}

const STATUS_DILEWATI: [RegExp, string][] = [
  [/^pembatalan diajukan$/i, "Pembatalan diajukan — dilewati, tidak diimpor"],
  [/^dibatalkan$/i, "Dibatalkan — dilewati, tidak diimpor"],
  [/^belum bayar$/i, "Belum Bayar — dilewati, tidak diimpor"],
];
const STATUS_BOLEH = /^(perlu dikirim|siap dikirim|sedang dikirim|dikirim|telah dikirim|selesai)$/i;

/** Pesanan yang batal / belum dibayar / sedang diretur tidak boleh memotong stok atau membuat piutang. */
export function statusImpor(status: string, statusPembatalan: string): { importable: boolean; reason: string | null } {
  const st = status.trim();
  const hit = STATUS_DILEWATI.find(([re]) => re.test(st));
  if (hit) return { importable: false, reason: hit[1] };
  if (statusPembatalan.trim()) return { importable: false, reason: `Status pembatalan/pengembalian "${statusPembatalan.trim()}" — dilewati, tidak diimpor` };
  if (STATUS_BOLEH.test(st)) return { importable: true, reason: null };
  return { importable: false, reason: `Status "${st || "(kosong)"}" tidak dikenali — dilewati, tidak diimpor` };
}

const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const KOLOM = {
  orderNo: "no. pesanan",
  status: "status pesanan",
  statusBatal: "status pembatalan/ pengembalian",
  dibuat: "waktu pesanan dibuat",
  metode: "metode pembayaran",
  skuInduk: "sku induk",
  nama: "nama produk",
  skuRef: "nomor referensi sku",
  variasi: "nama variasi",
  hargaAwal: "harga awal",
  harga: "harga setelah diskon",
  jumlah: "jumlah",
  subtotal: "subtotal pesanan",
  voucherPenjual: "voucher ditanggung penjual",
  voucherShopee: "voucher ditanggung shopee",
  koin: "potongan koin shopee",
  kartuKredit: "diskon kartu kredit",
  ongkirPembeli: "ongkos kirim dibayar oleh pembeli",
  potonganOngkir: "estimasi potongan biaya pengiriman",
  total: "total pembayaran",
  perkiraanOngkir: "perkiraan ongkos kirim",
  buyer: "username (pembeli)",
} as const;
type Kunci = keyof typeof KOLOM;
const WAJIB: Kunci[] = ["orderNo", "status", "dibuat", "nama", "harga", "jumlah"];
const NAMA_WAJIB: Record<string, string> = {
  orderNo: "No. Pesanan", status: "Status Pesanan", dibuat: "Waktu Pesanan Dibuat", nama: "Nama Produk", harga: "Harga Setelah Diskon", jumlah: "Jumlah",
};

function nilaiSel(cell: ExcelJS.Cell): string | number {
  const v = cell.value as unknown;
  if (v == null) return "";
  if (typeof v === "number") return v;
  if (typeof v === "string") return v.trim();
  if (typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace("T", " ");
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown };
    if (Array.isArray(o.richText)) return o.richText.map(t => t.text).join("").trim();
    if ("result" in o && (typeof o.result === "string" || typeof o.result === "number")) return typeof o.result === "string" ? o.result.trim() : o.result;
    if (typeof o.text === "string") return o.text.trim();
  }
  return String(cell.text ?? "").trim();
}

function tanggalIso(raw: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(raw);
  const indo = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?!\d)/.exec(raw);
  const y = Number(iso?.[1] ?? indo?.[3]), m = Number(iso?.[2] ?? indo?.[2]), d = Number(iso?.[3] ?? indo?.[1]);
  if (!iso && !indo) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

type Kolom = Map<Kunci, number>;

function petaKolom(ws: ExcelJS.Worksheet): { kolom: Kolom; barisHeader: number } | null {
  for (let r = 1; r <= Math.min(3, ws.rowCount); r++) {
    const peta = new Map<string, number>();
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => { const k = norm(nilaiSel(cell)); if (k && !peta.has(k)) peta.set(k, col); });
    if (peta.has(KOLOM.orderNo) && peta.has(KOLOM.status)) {
      const kolom: Kolom = new Map();
      for (const [kunci, nama] of Object.entries(KOLOM) as [Kunci, string][]) { const c = peta.get(nama); if (c) kolom.set(kunci, c); }
      return { kolom, barisHeader: r };
    }
  }
  return null;
}

const nol: ShopeeRincian = { voucherPenjual: 0, voucherShopee: 0, koin: 0, kartuKredit: 0, ongkirPembeli: 0, potonganOngkir: 0, perkiraanOngkir: 0 };

export async function bacaShopeeXlsx(file: Uint8Array | Buffer): Promise<{ orders: ShopeeOrder[]; error: string | null }> {
  const gagal = (error: string) => ({ orders: [] as ShopeeOrder[], error });
  if (file.length > BATAS_FILE_SHOPEE) return gagal("File lebih dari 5 MB. Ekspor per hari atau per rentang yang lebih pendek.");
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(file as unknown as Parameters<typeof wb.xlsx.load>[0]); } catch { return gagal("File tidak bisa dibaca. Gunakan file .xlsx hasil ekspor pesanan Shopee."); }

  const kandidat = [...wb.worksheets].sort((a, b) => Number(norm(b.name) === "orders") - Number(norm(a.name) === "orders"));
  let ws: ExcelJS.Worksheet | undefined, peta: ReturnType<typeof petaKolom> = null;
  for (const sheet of kandidat) { peta = petaKolom(sheet); if (peta) { ws = sheet; break; } }
  if (!ws || !peta) return gagal("Sheet pesanan tidak ditemukan: kolom 'No. Pesanan' dan 'Status Pesanan' harus ada. Pastikan ini file ekspor pesanan Shopee.");
  const hilang = WAJIB.filter(k => !peta!.kolom.has(k)).map(k => NAMA_WAJIB[k]);
  if (hilang.length) return gagal(`Kolom wajib tidak ditemukan: ${hilang.join(", ")}.`);
  if (ws.rowCount > BATAS_BARIS) return gagal(`File berisi lebih dari ${BATAS_BARIS} baris. Ekspor dengan rentang yang lebih pendek.`);

  const { kolom, barisHeader } = peta;
  const orders = new Map<string, { order: ShopeeOrder; reasons: string[]; bad: string[]; statuses: { s: string; b: string }[] }>();
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= barisHeader) return;
    const get = (k: Kunci) => (kolom.has(k) ? nilaiSel(row.getCell(kolom.get(k)!)) : "");
    const txt = (k: Kunci) => String(get(k)).trim();
    const orderNo = txt("orderNo");
    if (!orderNo) return;
    const qty = parseShopeeNumber(get("jumlah")), harga = parseShopeeNumber(get("harga"));
    const line: ShopeeLine = {
      baris: rowNumber, skuInduk: txt("skuInduk"), skuRef: txt("skuRef"), namaProduk: txt("nama"), variasi: txt("variasi"),
      qty, hargaAwal: parseShopeeNumber(get("hargaAwal")), harga, subtotal: parseShopeeNumber(get("subtotal")),
    };
    let entry = orders.get(orderNo);
    if (!entry) {
      const num = (k: Kunci) => { const n = parseShopeeNumber(get(k)); return Number.isFinite(n) ? n : 0; };
      const totalRaw = txt("total");
      const total = totalRaw === "" ? null : parseShopeeNumber(totalRaw);
      entry = {
        order: {
          orderNo, status: txt("status"), statusPembatalan: txt("statusBatal"), importable: true, dataValid: true, skipReason: null,
          tanggal: tanggalIso(txt("dibuat")), buyer: txt("buyer"), metodeBayar: txt("metode"), lines: [], subtotalBarang: 0,
          totalPembayaran: total !== null && Number.isFinite(total) ? total : null,
          // Angka tingkat pesanan: Shopee mengulangnya di setiap baris, jadi diambil dari baris PERTAMA saja.
          rincian: { ...nol, voucherPenjual: num("voucherPenjual"), voucherShopee: num("voucherShopee"), koin: num("koin"), kartuKredit: num("kartuKredit"), ongkirPembeli: num("ongkirPembeli"), potonganOngkir: num("potonganOngkir"), perkiraanOngkir: num("perkiraanOngkir") },
          selisih: null,
        },
        reasons: [], bad: [], statuses: [],
      };
      orders.set(orderNo, entry);
    }
    entry.statuses.push({ s: txt("status"), b: txt("statusBatal") });
    if (!entry.order.buyer) entry.order.buyer = txt("buyer");
    if (!Number.isFinite(qty) || qty <= 0) entry.bad.push(`baris ${rowNumber}: jumlah tidak valid`);
    if (!Number.isFinite(harga) || harga < 0) entry.bad.push(`baris ${rowNumber}: harga tidak valid`);
    entry.order.lines.push(line);
  });

  const hasil: ShopeeOrder[] = [];
  for (const { order, bad, statuses } of orders.values()) {
    const cek = statuses.map(x => statusImpor(x.s, x.b));
    const dilewati = cek.find(c => !c.importable);
    order.importable = !dilewati;
    order.skipReason = dilewati?.reason ?? null;
    if (bad.length) { order.dataValid = false; if (order.importable) { order.importable = false; order.skipReason = `Data jumlah/harga tidak valid (${bad.join("; ")}) — dilewati`; } }
    if (!order.tanggal) { order.dataValid = false; if (order.importable) { order.importable = false; order.skipReason = "Tanggal pesanan tidak terbaca — dilewati"; } }
    order.subtotalBarang = order.lines.reduce((a, l) => a + (Number.isFinite(l.qty) && Number.isFinite(l.harga) ? l.qty * l.harga : 0), 0);
    const r = order.rincian;
    if (order.totalPembayaran !== null) {
      const harapan = order.subtotalBarang - r.voucherPenjual - r.voucherShopee - r.koin - r.kartuKredit + r.ongkirPembeli;
      order.selisih = Math.round((order.totalPembayaran - harapan) * 100) / 100;
    }
    hasil.push(order);
  }
  return { orders: hasil, error: null };
}
