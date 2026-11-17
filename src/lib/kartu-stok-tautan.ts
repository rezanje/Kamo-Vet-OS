// Kolom "No. Sumber" di Kartu Stok bisa diklik ke dokumen asalnya (permintaan Anisa,
// 17 Nov: "pembelian langsung bisa diklik langsung ke pembelian, pemindahan juga").
//
// `stock_moves.source_ref` menyimpan NOMOR dokumen (FB.2026.11.00043, PRM-20261114-0002)
// atau, untuk sebagian sumber, id dokumen (UUID). Halaman dokumen dibuka pakai id, jadi
// nomor dicari dulu ke tabel dokumennya — sekali per tabel untuk semua baris yang tampil,
// dibatasi ke tabel yang memang mungkin untuk sumber itu. Nomor yang tidak ketemu (dokumen
// lama, dihapus, atau tidak boleh dibaca user ini) tetap tampil sebagai teks biasa: lebih
// baik tidak ada tautan daripada tautan buntu.

import { PETA_DOKUMEN, hrefInvoiceKlinik, hrefPerintahProduksi } from "@/lib/tautan-dokumen";

type Target = {
  tabel: string;
  kolom: string;
  extra?: string;
  href: (row: { id: string; extra?: string | null }) => string;
};

const dariPeta = (tabel: string): Target => {
  const p = PETA_DOKUMEN.find((x) => x.tabel === tabel);
  if (!p) throw new Error(`Peta dokumen ${tabel} tidak ada`);
  return { tabel: p.tabel, kolom: p.kolom, extra: p.extra, href: p.href };
};

export const TARGET: Record<string, Target> = {
  struk: dariPeta("sales"),
  fakturJual: dariPeta("sales_invoices"),
  returJual: dariPeta("sales_returns"),
  returGrosir: dariPeta("wholesale_returns"),
  pesananBeli: dariPeta("purchase_orders"),
  fakturBeli: dariPeta("purchase_invoices"),
  returBeli: dariPeta("purchase_returns"),
  penerimaan: dariPeta("goods_receipts"),
  hasilOpname: dariPeta("opname_results"),
  perintahOpname: dariPeta("opname_orders"),
  invoiceKlinik: { tabel: "invoices", kolom: "invoice_no", extra: "visit_id", href: (r) => hrefInvoiceKlinik(r.extra ?? "", r.id) },
  produksi: { tabel: "production_orders", kolom: "no_produksi", extra: "no_produksi", href: (r) => hrefPerintahProduksi(r.extra ?? "") },
  pemindahan: { tabel: "stock_transfers", kolom: "no_pemindahan", href: (r) => `/pos/pemindahan/${r.id}` },
  permintaan: { tabel: "stock_requests", kolom: "no_request", href: (r) => `/pos/permintaan/${r.id}` },
  permintaanId: { tabel: "stock_requests", kolom: "id", href: (r) => `/pos/permintaan/${r.id}` },
  penyesuaian: { tabel: "inventory_adjustments", kolom: "no_adj", href: (r) => `/pos/penyesuaian/${r.id}` },
  refundKlinik: { tabel: "clinic_refunds", kolom: "no_refund", extra: "visit_id", href: (r) => `/klinik/pembayaran/${r.extra ?? ""}` },
};
type KunciTarget = keyof typeof TARGET;

// Sumber mutasi → tabel tempat nomornya dicari (urut prioritas).
const SUMBER_TARGET: Record<string, KunciTarget[]> = {
  purchase: ["pesananBeli", "penerimaan"],
  "purchase-receipt-void": ["penerimaan", "pesananBeli"],
  "purchase-invoice-void": ["fakturBeli"],
  "faktur-langsung": ["fakturBeli"],
  "retur-beli": ["returBeli"],
  sale: ["struk", "fakturJual"],
  "sale-group": ["struk", "fakturJual"],
  "sale-online": ["struk", "fakturJual"],
  "retur-jual": ["returJual", "returGrosir"],
  "retur-jual-group": ["returJual", "returGrosir"],
  "wholesale-return": ["returGrosir"],
  klinik: ["invoiceKlinik"],
  "klinik-bmhp": ["invoiceKlinik"],
  "klinik-edit": ["invoiceKlinik"],
  "pesanan-selesai": ["invoiceKlinik"],
  "retur-klinik": ["refundKlinik"],
  transfer: ["pemindahan"],
  "transfer-batal": ["pemindahan"],
  "transfer-in": ["pemindahan"],
  "transfer-out": ["pemindahan"],
  "kirim-permintaan": ["permintaan", "permintaanId"],
  "batal-kirim-permintaan": ["permintaan", "permintaanId"],
  "terima-permintaan": ["permintaanId", "permintaan"],
  "retur-permintaan": ["permintaanId", "permintaan"],
  opname: ["hasilOpname", "perintahOpname"],
  "opname-selisih": ["hasilOpname", "invoiceKlinik"],
  penyesuaian: ["penyesuaian"],
  produksi: ["produksi"],
};

// Sumber yang source_ref-nya id jejak audit / slug, bukan dokumen yang bisa dibuka.
const TANPA_TAUTAN = new Set(["saldo-awal", "saldo-awal-accurate", "sale-void", "return-record-void", "manual"]);

// Racikan menyimpan id resep; halaman racik sudah menangani id yang tidak ada.
const SUMBER_RACIK = new Set(["racik", "racik-koreksi", "racik-kembali"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const kunciBaris = (source: string, ref: string) => `${source}\u0000${ref}`;

/** Tabel mana yang perlu dibaca, dengan nomor apa saja. Murni supaya bisa dites. */
export function rencanaTautan(baris: { source: string; source_ref: string | null }[]): Map<KunciTarget, Set<string>> {
  const rencana = new Map<KunciTarget, Set<string>>();
  const semuaNomor = (Object.keys(TARGET) as KunciTarget[]).filter((k) => TARGET[k].kolom !== "id");
  for (const b of baris) {
    const ref = (b.source_ref ?? "").trim();
    if (!ref || ref.length > 80 || TANPA_TAUTAN.has(b.source) || SUMBER_RACIK.has(b.source)) continue;
    const isUuid = UUID.test(ref);
    // Sumber baru yang belum dipetakan: coba semua tabel nomor, asal ref-nya bukan UUID.
    const kandidat = SUMBER_TARGET[b.source] ?? (isUuid ? [] : semuaNomor);
    for (const k of kandidat) {
      if ((TARGET[k].kolom === "id") !== isUuid) continue;
      if (!rencana.has(k)) rencana.set(k, new Set());
      rencana.get(k)!.add(ref);
    }
  }
  return rencana;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { from: (tabel: string) => any };

/**
 * Tautan dokumen per baris kartu stok. Kunci = `hrefSumber(source, ref)`.
 * Gagal baca satu tabel tidak menggagalkan kartu stok — barisnya saja yang tidak bertautan.
 */
export async function muatTautanKartuStok(
  supabase: Client,
  baris: { source: string; source_ref: string | null }[],
): Promise<Map<string, string>> {
  const rencana = rencanaTautan(baris);
  const ketemu = new Map<KunciTarget, Map<string, string>>();
  await Promise.all([...rencana.entries()].map(async ([k, refs]) => {
    const t = TARGET[k];
    try {
      const kolom = [...new Set(["id", t.kolom, ...(t.extra ? [t.extra] : [])])].join(", ");
      const { data, error } = await supabase.from(t.tabel).select(kolom).in(t.kolom, [...refs]);
      if (error || !Array.isArray(data)) return;
      const peta = new Map<string, string>();
      for (const row of data as Record<string, unknown>[]) {
        const nomor = String(row[t.kolom] ?? "");
        if (!nomor || row.id == null) continue;
        peta.set(nomor, t.href({ id: String(row.id), extra: t.extra ? (row[t.extra] as string | null) : null }));
      }
      ketemu.set(k, peta);
    } catch {
      // Tabel tidak terbaca (hak akses / jaringan): biarkan tanpa tautan.
    }
  }));

  const hasil = new Map<string, string>();
  for (const b of baris) {
    const ref = (b.source_ref ?? "").trim();
    if (!ref || hasil.has(kunciBaris(b.source, ref))) continue;
    if (SUMBER_RACIK.has(b.source)) {
      if (UUID.test(ref)) hasil.set(kunciBaris(b.source, ref), `/klinik/racik/${encodeURIComponent(ref)}`);
      continue;
    }
    const kandidat = SUMBER_TARGET[b.source] ?? (Object.keys(TARGET) as KunciTarget[]);
    for (const k of kandidat) {
      const href = ketemu.get(k)?.get(ref);
      if (href) { hasil.set(kunciBaris(b.source, ref), href); break; }
    }
  }
  return hasil;
}

export function hrefSumber(tautan: Map<string, string>, source: string, ref: string | null): string | null {
  const r = (ref ?? "").trim();
  return r ? tautan.get(kunciBaris(source, r)) ?? null : null;
}
