// Impor pesanan Shopee — pencocokan barang + analisis pratinjau (murni, tanpa server/DB).
// Dipakai server (pratinjau & simpan) dan klien (hitung ulang peringatan saat dropdown diubah).
import type { ShopeeLine, ShopeeOrder } from "./shopee-import";

export type CatalogItem = { id: string; code: string; name: string; sell_price: number; stock: number };
export type MatchKind = "sku" | "nama" | "nama-normal" | "perkiraan" | "ambigu" | "tidak";
export type LineMatch = { itemId: string | null; kind: MatchKind; perluPeriksa: boolean };

/** Selisih harga Shopee vs harga master yang masih dianggap wajar. */
export const TOLERANSI_HARGA = 0.2;

const rp = (n: number) => `Rp ${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

export function normalisasiNama(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}
const rapi = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const tokens = (s: string) => new Set(normalisasiNama(s).split(" ").filter(Boolean));

/** Urutan: kode (Nomor Referensi SKU, lalu SKU Induk) → nama persis → nama ternormalisasi → perkiraan (wajib diperiksa). */
export function cocokkanBarang(line: Pick<ShopeeLine, "skuInduk" | "skuRef" | "namaProduk" | "variasi">, catalog: CatalogItem[]): LineMatch {
  const hasil = (hits: CatalogItem[], kind: MatchKind): LineMatch | null => {
    if (hits.length === 0) return null;
    if (hits.length > 1) return { itemId: null, kind: "ambigu", perluPeriksa: true };
    return { itemId: hits[0].id, kind, perluPeriksa: false };
  };
  // Pesanan dengan Nama Variasi: SKU Induk / nama produk dipakai bersama semua variasi (ukuran, isi dus, rasa), jadi kecocokan lewat
  // keduanya hanya perkiraan dan WAJIB dicentang Owner. Hanya Nomor Referensi SKU (SKU variasi) yang cocok persis ke satu barang yang diam-diam.
  const adaVariasi = line.variasi.trim() !== "";
  const tanpaSku = (m: LineMatch | null): LineMatch | null =>
    adaVariasi && m && m.itemId ? { itemId: m.itemId, kind: "perkiraan", perluPeriksa: true } : m;
  const kode = [{ k: line.skuRef.trim(), skuVariasi: true }, { k: line.skuInduk.trim(), skuVariasi: false }].filter(x => x.k);
  for (const { k, skuVariasi } of kode) {
    const m = hasil(catalog.filter(i => rapi(i.code) === rapi(k)), "sku") ?? hasil(catalog.filter(i => i.code && normalisasiNama(i.code) === normalisasiNama(k)), "sku");
    if (m) return skuVariasi ? m : tanpaSku(m)!;
  }
  const teks = [line.skuRef, line.skuInduk, line.namaProduk].map(s => s.trim()).filter(Boolean);
  for (const t of teks) { const m = hasil(catalog.filter(i => rapi(i.name) === rapi(t)), "nama"); if (m) return tanpaSku(m)!; }
  for (const t of teks) { const m = hasil(catalog.filter(i => normalisasiNama(i.name) === normalisasiNama(t)), "nama-normal"); if (m) return tanpaSku(m)!; }

  // Perkiraan: seluruh kata nama master termuat di teks Shopee (nama produk di Shopee biasanya diberi
  // embel-embel SEO), atau kode/SKU Shopee yang lebih pendek termuat di nama master.
  const sumber = [{ t: line.namaProduk, sku: false }, { t: `${line.namaProduk} ${line.variasi}`, sku: false }, { t: line.skuInduk, sku: true }, { t: line.skuRef, sku: true }].filter(x => x.t.trim());
  const skor = new Map<string, number>();
  for (const it of catalog) {
    const nama = tokens(it.name);
    if (nama.size < 2) continue;
    let best = 0;
    for (const s of sumber) {
      const tk = tokens(s.t);
      if ([...nama].every(w => tk.has(w))) best = Math.max(best, nama.size);
      else if (s.sku && tk.size >= 2 && [...tk].every(w => nama.has(w))) best = Math.max(best, tk.size);
    }
    if (best > 0) skor.set(it.id, best);
  }
  if (skor.size) {
    const max = Math.max(...skor.values());
    const teratas = [...skor.entries()].filter(([, v]) => v === max).map(([id]) => id);
    if (teratas.length === 1) return { itemId: teratas[0], kind: "perkiraan", perluPeriksa: true };
    return { itemId: null, kind: "ambigu", perluPeriksa: true };
  }
  return { itemId: null, kind: "tidak", perluPeriksa: true };
}

/** Gudang bawaan: satu-satunya gudang online yang cabangnya memuat "Panduraya"; selain itu pengguna wajib memilih. */
export function pilihGudangDefault(warehouses: { id: string; name: string; branch_name: string }[]): string {
  const hit = warehouses.filter(w => /panduraya/i.test(w.branch_name));
  return hit.length === 1 ? hit[0].id : "";
}

export const kunciBaris = (orderNo: string, index: number) => `${orderNo}|${index}`;

export type Peringatan = { level: "blok" | "peringatan" | "info"; text: string };
export type AnalisisBaris = ShopeeLine & { index: number; match: LineMatch; item: CatalogItem | null; warnings: Peringatan[] };
export type StatusAnalisis = "siap" | "perlu-perbaikan" | "duplikat" | "dilewati";
export type AnalisisPesanan = {
  order: ShopeeOrder;
  status: StatusAnalisis;
  alasan: string | null;
  lines: AnalisisBaris[];
  warnings: Peringatan[];
  /** Σ qty × Harga Setelah Diskon — nilai yang akan dicatat sebagai total order. */
  totalDicatat: number;
  saveable: boolean;
};
export type ExistingOrders = Record<string, { noStruk: string | null; voided: boolean }>;
export type AnalisisOpts = {
  existing: ExistingOrders;
  /** kunciBaris → item_id pilihan manual (null = kosongkan). */
  overrides: Record<string, string | null>;
  /** kunciBaris yang kecocokan perkiraannya sudah diperiksa pengguna. */
  konfirmasi: Set<string>;
  /** No. Pesanan berstatus dilewati yang SENGAJA disertakan Owner. */
  sertakan: Set<string>;
  toleransiHarga?: number;
};

export function analisisImpor(orders: ShopeeOrder[], catalog: CatalogItem[], opts: AnalisisOpts): AnalisisPesanan[] {
  const byId = new Map(catalog.map(i => [i.id, i]));
  const tol = opts.toleransiHarga ?? TOLERANSI_HARGA;
  const kumulatif = new Map<string, number>();

  return orders.map(order => {
    const warnings: Peringatan[] = [];
    const lines: AnalisisBaris[] = order.lines.map((l, index) => {
      const key = kunciBaris(order.orderNo, index);
      const diganti = Object.prototype.hasOwnProperty.call(opts.overrides, key);
      const auto = cocokkanBarang(l, catalog);
      const itemId = diganti ? opts.overrides[key] : auto.itemId;
      const item = itemId ? byId.get(itemId) ?? null : null;
      const match: LineMatch = diganti
        ? { itemId: item?.id ?? null, kind: item ? "nama" : "tidak", perluPeriksa: false }
        : item ? auto : { itemId: null, kind: auto.kind === "ambigu" ? "ambigu" : "tidak", perluPeriksa: true };
      const w: Peringatan[] = [];
      if (!item) {
        w.push({ level: "blok", text: match.kind === "ambigu" ? "Lebih dari satu barang master cocok — pilih manual." : "Belum cocok dengan barang master — pilih barangnya." });
      } else {
        if (!diganti && auto.kind === "perkiraan" && !opts.konfirmasi.has(key)) w.push({ level: "blok", text: "Kecocokan perkiraan — periksa lalu centang konfirmasi (atau pilih barang manual)." });
        if (!(item.sell_price > 0)) w.push({ level: "peringatan", text: `Harga jual master ${item.name} Rp 0 — periksa harga.` });
        else if (Math.abs(l.harga - item.sell_price) / item.sell_price > tol) {
          const pct = Math.round(((l.harga - item.sell_price) / item.sell_price) * 100);
          w.push({ level: "peringatan", text: `Harga Shopee ${rp(l.harga)} beda ${pct > 0 ? "+" : ""}${pct}% dari harga master ${rp(item.sell_price)}. Harga Shopee tetap dipakai.` });
        }
      }
      return { ...l, index, match, item, warnings: w };
    });

    const totalDicatat = lines.reduce((a, l) => a + l.qty * l.harga, 0);
    const dup = opts.existing[order.orderNo];
    const disertakan = opts.sertakan.has(order.orderNo);
    let status: StatusAnalisis;
    let alasan: string | null = null;
    if (dup) {
      status = "duplikat";
      alasan = `Sudah diimpor sebagai ${dup.noStruk ?? "order lain"}${dup.voided ? " (order itu sudah dibatalkan)" : ""} — dilewati agar tidak dobel.`;
    } else if (!order.dataValid || (!order.importable && !disertakan)) {
      status = "dilewati";
      alasan = order.skipReason ?? "Dilewati";
    } else {
      status = "siap";
      if (!order.importable) warnings.push({ level: "peringatan", text: `${order.skipReason ?? "Pesanan dilewati"} — disertakan atas keputusan Owner.` });
    }

    if (status === "siap") {
      if (lines.length === 0) warnings.push({ level: "blok", text: "Pesanan tidak punya baris barang." });
      for (const l of lines) {
        if (!l.item) continue;
        const total = (kumulatif.get(l.item.id) ?? 0) + l.qty;
        kumulatif.set(l.item.id, total);
        if (total > l.item.stock) l.warnings.push({ level: "peringatan", text: `Stok gudang ${l.item.stock}, kebutuhan kumulatif ${total} — stok tidak cukup, simpan bisa ditolak.` });
      }
      const r = order.rincian;
      if (r.voucherPenjual > 0) warnings.push({ level: "peringatan", text: `Voucher penjual ${rp(r.voucherPenjual)} tidak dialokasikan ke harga barang — akan terlihat sebagai potongan saat dana cair.` });
      if (order.selisih !== null && Math.abs(order.selisih) >= 1 && order.totalPembayaran !== null) {
        warnings.push({
          level: "info",
          text: `Total Pembayaran Shopee ${rp(order.totalPembayaran)} beda ${rp(order.selisih)} dari total barang ${rp(totalDicatat)} setelah voucher/koin/ongkir (potongan ongkir ${rp(r.potonganOngkir)}). Kemungkinan biaya layanan/penanganan pembeli yang tidak dirinci di file. Harga tidak diubah; total yang dicatat ${rp(totalDicatat)}.`,
        });
      }
      if (/^cod/i.test(order.metodeBayar)) warnings.push({ level: "info", text: "COD: dicatat sebagai piutang marketplace seperti order Shopee lainnya." });
      const blok = warnings.some(w => w.level === "blok") || lines.some(l => l.warnings.some(w => w.level === "blok"));
      status = blok ? "perlu-perbaikan" : "siap";
    }
    return { order, status, alasan, lines, warnings, totalDicatat, saveable: status === "siap" };
  });
}
