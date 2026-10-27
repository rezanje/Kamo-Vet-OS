import { hariIniWIB } from "./tanggal";
import { readCompleteList } from "./checked-list";
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
//   discountMode 'package_total' = nominal untuk satu paket min_qty pada satu SKU.
//                  Absen berarti aturan lama: potongan per satuan.
//
// Promo tanpa daftar barang berlaku untuk semua barang.

export type PromoHitung = {
  id: string;
  name: string;
  itemIds: string[];                     // kosong = semua barang
  unit?: string | null;                    // impor Excel dapat membatasi satuan
  minQty: number | null;
  maxQty: number | null;
  kelipatan: boolean;
  autoApply: boolean;
  discountType: "percent" | "nominal" | null;
  discountValue: number | null;
  discountMode?: "per_unit" | "package_total";
  minSubtotal?: number | null;           // syarat nilai belanja (dari rule lama)
};

export type PromoDiscountMode = "per_unit" | "package_total";
export function promoDiscountMode(value: unknown): PromoDiscountMode {
  if (value == null || value === "" || value === "per_unit") return "per_unit";
  if (value === "package_total") return value;
  throw new Error("Cara hitung diskon promo tidak valid");
}

export function validatePackageDiscount(mode: PromoDiscountMode, discountType: string | null, minQty: number | null, itemIds: string[]): void {
  if (mode !== "package_total") return;
  if (discountType !== "nominal") throw new Error("Total per paket hanya untuk diskon nominal");
  if (minQty == null || !Number.isFinite(minQty) || minQty <= 0) throw new Error("Total per paket memerlukan min. qty");
  if (itemIds.length !== 1) throw new Error("Total per paket memerlukan tepat satu barang target");
}

export type BarisKeranjang = { item_id: string; qty: number; harga: number; satuan?: string | null };

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
  const capped = Math.min(kena, batas);
  // Package mode counts complete packages only. A cap below min_qty (blocked by
  // the editors, possible in direct rows) therefore yields no package at all.
  if (p.discountMode !== "package_total") return capped;
  return p.kelipatan ? Math.floor(capped / min) * min : capped >= min ? min : 0;
}

// Potongan rupiah untuk satu baris. Tidak pernah melebihi nilai barisnya —
// potongan lebih besar dari harga bikin total transaksi minus dan jurnalnya ikut salah.
export function potonganBaris(baris: BarisKeranjang, p: PromoHitung): number {
  if (!p.discountType || !p.discountValue || p.discountValue <= 0) return 0;
  const harga = Math.max(0, Number(baris.harga) || 0);
  const kena = qtyDapatPotongan(baris.qty, p);
  if (kena <= 0 || harga <= 0) return 0;

  if (p.discountMode === "package_total") {
    // A configured package is counted only when all of its min_qty units fit
    // under max_qty. One-time campaigns pay one package; repeating ones pay
    // each complete package. Extra non-qualifying units never enlarge the cap.
    // The stored master is validated as one SKU. Clinical pricing may map that
    // SKU to several synthetic rows, so only the monetary shape is checked here.
    if (p.discountType !== "nominal" || !p.minQty || p.minQty <= 0) throw new Error("Total per paket memerlukan diskon nominal dan min. qty");
    const min = p.minQty!;
    const groups = p.kelipatan ? Math.floor(kena / min) : 1;
    return Math.min(Math.round(p.discountValue * groups), Math.round(harga * min * groups));
  }

  const perUnit = p.discountType === "percent"
    ? Math.round((harga * Math.min(p.discountValue, 100)) / 100)
    : Math.min(p.discountValue, harga);           // nominal tidak boleh > harga satuan

  const kotor = Math.round(perUnit * kena);
  return Math.min(kotor, Math.round(harga * (Number(baris.qty) || 0)));
}

function kenaPromo(p: PromoHitung, itemId: string, unit?: string | null): boolean {
  return (!p.unit || p.unit === unit) && (p.itemIds.length === 0 || p.itemIds.includes(itemId));
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

  const terbaik: (PotonganBaris | null)[] = cart.map((baris) => {
    let pilih: PotonganBaris | null = null;
    for (const p of aktif) {
      if (p.discountMode === "package_total" || !kenaPromo(p, baris.item_id, baris.satuan)) continue;
      const potongan = potonganBaris(baris, p);
      if (potongan <= 0) continue;
      if (!pilih || potongan > pilih.potongan) {
        pilih = {
          item_id: baris.item_id, potongan,
          qtyKena: qtyDapatPotongan(baris.qty, p),
          promoId: p.id, promoName: p.name,
        };
      }
    }
    return pilih;
  });

  // Total per paket punya SATU jatah per transaksi: "sekali" dan maks. qty
  // berlaku untuk keranjang, bukan per baris. Baris SKU/satuan/harga yang sama
  // (mis. obat yang sama diresepkan dua kali di satu kunjungan) dihitung bersama;
  // baris beda satuan/harga tidak digabung, hanya kelompok terbaik yang dapat paket.
  for (const p of aktif) {
    if (p.discountMode !== "package_total") continue;
    const kelompok = new Map<string, number[]>();
    cart.forEach((baris, index) => {
      if (!kenaPromo(p, baris.item_id, baris.satuan)) return;
      const key = JSON.stringify([baris.item_id, baris.satuan ?? "", Number(baris.harga) || 0]);
      kelompok.set(key, [...(kelompok.get(key) ?? []), index]);
    });
    let pilihan: { indexes: number[]; qty: number; potongan: number; qtyKena: number; selisih: number } | null = null;
    for (const indexes of kelompok.values()) {
      const qty = indexes.reduce((a, i) => a + (Number(cart[i].qty) || 0), 0);
      const potongan = potonganBaris({ ...cart[indexes[0]], qty }, p);
      // Satu baris tetap satu promo: paket menggantikan promo lain di baris itu
      // hanya kalau total potongannya lebih besar.
      const selisih = potongan - indexes.reduce((a, i) => a + (terbaik[i]?.potongan ?? 0), 0);
      if (potongan > 0 && selisih > 0 && (!pilihan || selisih > pilihan.selisih)) {
        pilihan = { indexes, qty, potongan, qtyKena: qtyDapatPotongan(qty, p), selisih };
      }
    }
    if (!pilihan) continue;
    let sisa = pilihan.potongan;
    pilihan.indexes.forEach((index, urutan) => {
      const porsi = (Number(cart[index].qty) || 0) / pilihan.qty;
      const potongan = urutan === pilihan.indexes.length - 1 ? sisa : Math.min(sisa, Math.floor(pilihan.potongan * porsi));
      sisa -= potongan;
      terbaik[index] = {
        item_id: cart[index].item_id, potongan,
        qtyKena: pilihan.qtyKena * porsi,
        promoId: p.id, promoName: p.name,
      };
    });
  }
  return terbaik.filter((hasil): hasil is PotonganBaris => !!hasil && hasil.potongan > 0);
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

  type Row = {
    id: string; name: string; rule: { min_subtotal?: number; unit?: string; discount_mode?: unknown } | null;
    branch_ids: string[] | null; valid_from: string | null; valid_until: string | null;
    min_qty: number | null; max_qty: number | null; kelipatan: boolean; auto_apply: boolean;
    discount_type: "percent" | "nominal" | null; discount_value: number | null;
  };

  const data = await readCompleteList<Row>((from,to) => supabase.from("promos")
    .select("id, name, rule, branch_ids, valid_from, valid_until, min_qty, max_qty, kelipatan, auto_apply, discount_type, discount_value", {count:"exact"})
    .eq("is_active",true).eq("auto_apply",true).order("id").range(from,to), "Promo aktif");

  const aktif = ((data ?? []) as Row[]).filter((p) => {
    if (p.branch_ids && p.branch_ids.length > 0 && !p.branch_ids.includes(branchId)) return false;
    if (p.valid_from && wibToday < p.valid_from) return false;
    if (p.valid_until && wibToday > p.valid_until) return false;
    return true;
  });
  if (aktif.length === 0) return [];

  type Target = {promo_id:string;item_id:string};
  const perPromo = new Map<string, string[]>();
  // A verified empty target list means all products. A failed/partial list must
  // never be turned into that meaning; composite PK provides stable identity.
  for(let offset=0;offset<aktif.length;offset+=200) {
    const ids=aktif.slice(offset,offset+200).map(p=>p.id);
    const itemRows=await readCompleteList<Target & {id:string}>(async(from,to)=>{
      const result=await supabase.from("promo_items").select("promo_id,item_id",{count:"exact"})
        .in("promo_id",ids).order("promo_id").order("item_id").range(from,to);
      return {...result,data:Array.isArray(result.data)?(result.data as Target[]).map(row=>({...row,id:row.promo_id&&row.item_id?`${row.promo_id}:${row.item_id}`:""})):null};
    },"Target barang promo");
    for(const row of itemRows) {
      const items=perPromo.get(row.promo_id)??[];
      items.push(row.item_id);perPromo.set(row.promo_id,items);
    }
  }

  return aktif.map((p) => {
    const itemIds=perPromo.get(p.id) ?? [];
    const mode=promoDiscountMode(p.rule?.discount_mode);
    validatePackageDiscount(mode,p.discount_type,p.min_qty == null ? null : Number(p.min_qty),itemIds);
    return {
      id: p.id, name: p.name, itemIds,
      unit: typeof p.rule?.unit === "string" ? p.rule.unit : null,
      minQty: p.min_qty == null ? null : Number(p.min_qty),
      maxQty: p.max_qty == null ? null : Number(p.max_qty),
      kelipatan: !!p.kelipatan, autoApply: true,
      discountType: p.discount_type,
      discountValue: p.discount_value == null ? null : Number(p.discount_value),
      discountMode: mode, minSubtotal: p.rule?.min_subtotal ?? null,
    };
  });
}
