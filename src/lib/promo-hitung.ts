import { hariIniWIB } from "./tanggal";
// Perhitungan potongan promo — pure, dipakai KLIEN (tampilan kasir) dan SERVER
// (angka yang benar-benar disimpan). Dipisah dari lib/promo.ts karena file itu
// hanya soal "promo ini aktif hari ini di cabang mana", bukan soal uang.
//
// Model aturannya sengaja sesederhana yang bisa dijelaskan ke pemilik toko:
//
//   min_qty    syarat minimum. Beli kurang dari ini, promo tidak jalan.
//   max_qty    batas jumlah yang dapat potongan. Kosong = tanpa batas.
//   kelipatan  false → syarat terpenuhi, SELURUH qty dapat potongan.
//              true  → potongan berulang tiap kelipatan min_qty.
//                      Contoh min 2, beli 5: yang dapat 4, sisa 1 harga normal.
//   diskon     'percent' = persen dari harga satuan; 'nominal' = rupiah per satuan.
//
// Promo tanpa daftar barang berlaku untuk semua barang.

export type PromoHitung = {
  id: string;
  name: string;
  itemIds: string[];                     // kosong = semua barang
  minQty: number | null;
  maxQty: number | null;
  kelipatan: boolean;
  autoApply: boolean;
  discountType: "percent" | "nominal" | null;
  discountValue: number | null;
  minSubtotal?: number | null;           // syarat nilai belanja (dari rule lama)
};

export type BarisKeranjang = { item_id: string; qty: number; harga: number };

export type PotonganBaris = {
  item_id: string;
  potongan: number;      // rupiah, untuk SELURUH baris ini
  qtyKena: number;       // berapa unit yang dapat potongan
  promoId: string;
  promoName: string;
};

// Berapa unit dari satu baris yang berhak dapat potongan.
export function qtyDapatPotongan(qty: number, p: PromoHitung): number {
  const q = Math.max(0, Number(qty) || 0);
  if (q <= 0) return 0;
  const min = p.minQty && p.minQty > 0 ? p.minQty : 1;
  if (q < min) return 0;                                  // syarat belum terpenuhi

  // kelipatan: hanya kelipatan penuh dari min_qty yang dapat (beli 5, min 2 → 4).
  const kena = p.kelipatan ? Math.floor(q / min) * min : q;
  const batas = p.maxQty && p.maxQty > 0 ? p.maxQty : Infinity;
  return Math.min(kena, batas);
}

// Potongan rupiah untuk satu baris. Tidak pernah melebihi nilai barisnya —
// potongan lebih besar dari harga bikin total transaksi minus dan jurnalnya ikut salah.
export function potonganBaris(baris: BarisKeranjang, p: PromoHitung): number {
  if (!p.discountType || !p.discountValue || p.discountValue <= 0) return 0;
  const harga = Math.max(0, Number(baris.harga) || 0);
  const kena = qtyDapatPotongan(baris.qty, p);
  if (kena <= 0 || harga <= 0) return 0;

  const perUnit = p.discountType === "percent"
    ? Math.round((harga * Math.min(p.discountValue, 100)) / 100)
    : Math.min(p.discountValue, harga);           // nominal tidak boleh > harga satuan

  const kotor = Math.round(perUnit * kena);
  return Math.min(kotor, Math.round(harga * (Number(baris.qty) || 0)));
}

function kenaPromo(p: PromoHitung, itemId: string): boolean {
  return p.itemIds.length === 0 || p.itemIds.includes(itemId);
}

// Potongan promo untuk seluruh keranjang.
//
// Satu baris hanya dapat SATU promo — yang potongannya paling besar. Menumpuk
// beberapa promo di barang yang sama gampang bikin harga jatuh di bawah modal
// tanpa ada yang sadar; kalau nanti memang mau ditumpuk, itu keputusan bisnis
// yang harus diambil sadar, bukan efek samping.
export function hitungPromoKeranjang(promos: PromoHitung[], cart: BarisKeranjang[]): PotonganBaris[] {
  const subtotal = cart.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.harga) || 0), 0);

  const aktif = promos.filter((p) =>
    p.autoApply &&
    !!p.discountType &&
    (p.minSubtotal == null || subtotal >= p.minSubtotal),
  );

  const hasil: PotonganBaris[] = [];
  for (const baris of cart) {
    let terbaik: PotonganBaris | null = null;
    for (const p of aktif) {
      if (!kenaPromo(p, baris.item_id)) continue;
      const potongan = potonganBaris(baris, p);
      if (potongan <= 0) continue;
      if (!terbaik || potongan > terbaik.potongan) {
        terbaik = {
          item_id: baris.item_id, potongan,
          qtyKena: qtyDapatPotongan(baris.qty, p),
          promoId: p.id, promoName: p.name,
        };
      }
    }
    if (terbaik) hasil.push(terbaik);
  }
  return hasil;
}

// Ringkasan untuk ditampilkan di layar kasir.
export function totalPotonganPromo(hasil: PotonganBaris[]): number {
  return hasil.reduce((a, h) => a + h.potongan, 0);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

// Promo yang aktif hari ini di cabang ini, siap dipakai hitungPromoKeranjang.
// Dipakai SERVER saat checkout — angka promo dari keranjang tidak dipercaya.
export async function loadPromoAktif(supabase: AnyClient, branchId: string): Promise<PromoHitung[]> {
  const wibToday = hariIniWIB();

  const { data } = await supabase
    .from("promos")
    .select("id, name, rule, branch_ids, valid_from, valid_until, min_qty, max_qty, kelipatan, auto_apply, discount_type, discount_value")
    .eq("is_active", true)
    .eq("auto_apply", true);

  type Row = {
    id: string; name: string; rule: { min_subtotal?: number } | null;
    branch_ids: string[] | null; valid_from: string | null; valid_until: string | null;
    min_qty: number | null; max_qty: number | null; kelipatan: boolean; auto_apply: boolean;
    discount_type: "percent" | "nominal" | null; discount_value: number | null;
  };

  const aktif = ((data ?? []) as Row[]).filter((p) => {
    if (p.branch_ids && p.branch_ids.length > 0 && !p.branch_ids.includes(branchId)) return false;
    if (p.valid_from && wibToday < p.valid_from) return false;
    if (p.valid_until && wibToday > p.valid_until) return false;
    return true;
  });
  if (aktif.length === 0) return [];

  const { data: itemRows } = await supabase
    .from("promo_items").select("promo_id, item_id").in("promo_id", aktif.map((p) => p.id));
  const perPromo = new Map<string, string[]>();
  for (const r of (itemRows ?? []) as { promo_id: string; item_id: string }[]) {
    perPromo.set(r.promo_id, [...(perPromo.get(r.promo_id) ?? []), r.item_id]);
  }

  return aktif.map((p) => ({
    id: p.id, name: p.name,
    itemIds: perPromo.get(p.id) ?? [],
    minQty: p.min_qty == null ? null : Number(p.min_qty),
    maxQty: p.max_qty == null ? null : Number(p.max_qty),
    kelipatan: !!p.kelipatan,
    autoApply: true,
    discountType: p.discount_type,
    discountValue: p.discount_value == null ? null : Number(p.discount_value),
    minSubtotal: p.rule?.min_subtotal ?? null,
  }));
}
