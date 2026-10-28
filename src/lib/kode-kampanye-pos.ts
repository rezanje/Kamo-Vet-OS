// Kode kampanye (C05) di POS back-office (/pos/transaksi): satu rumus untuk layar DAN
// server, supaya angka yang dilihat kasir sama dengan yang tersimpan di struk.
//
// Back-office hanya menerima kode KAMPANYE (voucher biasa tetap lewat layar kasir).
// Urutannya sama dengan kasir petshop: promo (termasuk promo tujuan kode) → voucher
// tujuan kode dihitung dari nilai setelah promo → diskon golongan & manual. Batas
// pemakaian kode dijaga database saat struk ditulis dan saat dibayar.
import { bacaKode, pesanBukanKampanye, pesanKampanyeDitolak, promoDenganKode, type KodeKampanye } from "./kode-kampanye";
import { totalPotonganPromo, type PromoHitung } from "./promo-hitung";
import { serviceLinePromos } from "./service-line-promos";
import { pesanVoucherDitolak, potonganVoucher, type VoucherRow } from "./voucher";

type Baris = { item_id: string; qty: number; harga: number; item_type?: string; row_key?: string; satuan?: string | null };

export type HasilKodePos = {
  /** Alasan kode ditolak; null = tanpa kode atau kodenya sah. */
  tolak: string | null;
  /** Rincian promo per baris (sudah termasuk promo tujuan kode bila ada). */
  rincianPromo: ReturnType<typeof serviceLinePromos>;
  potonganPromo: number;
  potonganVoucher: number;
  /** Ditulis ke struk: voucher tujuan (atau null) dan kode kampanye yang diketik. */
  voucherCode: string | null;
  campaignCode: string | null;
};

export function hitungKodeKampanyePos(input: {
  kode: unknown;
  /** Kode kampanye yang dikenal (server: hasil baca satu kode; layar: daftar aktif). */
  daftar: KodeKampanye[];
  promos: PromoHitung[];
  cart: Baris[];
  subtotal: number;
  /** Voucher tujuan kode (null bila tidak terbaca / kode terikat promo). */
  voucher: VoucherRow | null;
  hariIni: string;
  customerId: string | null;
  categoryId: string | null;
}): HasilKodePos {
  const kode = bacaKode(input.kode, input.daftar);
  // Tanpa kode (atau kode ditolak) hanya promo otomatis yang berlaku.
  const rincianDasar = serviceLinePromos(input.promos, input.cart);
  const kosong = { rincianPromo: rincianDasar, potonganPromo: totalPotonganPromo(rincianDasar),
    potonganVoucher: 0, voucherCode: null, campaignCode: null };
  if (!kode.kode) return { tolak: null, ...kosong };

  const promoAktif = promoDenganKode(input.promos, kode.promoId);
  const rincianPromo = kode.promoId ? serviceLinePromos(promoAktif, input.cart) : rincianDasar;
  const potonganPromo = totalPotonganPromo(rincianPromo);
  const tolakKode = pesanBukanKampanye(kode.kode, kode.kampanye)
    ?? pesanKampanyeDitolak(kode.kampanye!, promoAktif.some((p) => p.id === kode.promoId),
      rincianPromo.some((h) => h.promoId === kode.promoId));
  if (tolakKode) return { tolak: tolakKode, ...kosong };

  const k = kode.kampanye!;
  let nilaiVoucher = 0;
  if (k.voucher_code) {
    const voucher = input.voucher?.code === k.voucher_code ? input.voucher : null;
    const dasar = Math.max(0, input.subtotal - potonganPromo);
    const tolak = pesanVoucherDitolak(voucher, input.hariIni, {
      dasar, adaPromoOtomatis: rincianPromo.length > 0, customerId: input.customerId, categoryId: input.categoryId,
    });
    if (tolak || !voucher) return { tolak: tolak ?? "Kode voucher tidak ditemukan", ...kosong };
    nilaiVoucher = potonganVoucher(dasar, voucher);
  }
  return { tolak: null, rincianPromo, potonganPromo, potonganVoucher: nilaiVoucher, voucherCode: k.voucher_code, campaignCode: k.code };
}
