// Atribusi potongan tagihan klinik: siapa yang memberi potongan, bukan satu
// angka `discount` gabungan. Sama seperti sale_items di kasir petshop (#312),
// tapi klinik juga menyimpan voucher dan diskon golongan terpisah di kepala
// invoice supaya laporan per program tidak perlu menebak.
//
// Murni, tanpa database: dipakai aksi pembayaran per kunjungan DAN pembayaran
// rombongan, dan bisa diuji tanpa memposting apa pun.

export type RincianPromoKlinik = {
  /** Index baris pada daftar baris yang dikirim ke hitungPotonganKlinik. */
  lineIndex: number;
  promoId: string;
  promoName: string;
  potongan: number;
};

export type AtribusiBaris = { promo_id: string; promo_discount: number };

export type AtribusiKlinik = {
  /** Kunci = index baris; baris tanpa promo sengaja tidak masuk. */
  baris: Map<number, AtribusiBaris>;
  voucher_discount: number;
  diskon_kategori: number;
};

const sen = (value: number) => Math.round((Number(value) || 0) * 100);

/**
 * Pecah potongan yang benar-benar diberikan (`discount`) menjadi bagian promo
 * per baris, voucher, dan diskon golongan.
 *
 * `discount` adalah batas keras: di dalamnya masih ada diskon manual kasir dan
 * poin, jadi jumlah atribusi tidak boleh melebihinya. Bila mesin potongan sempat
 * dibatasi (promo + golongan + voucher lebih besar dari tagihan), seluruh
 * atribusi dikecilkan proporsional — database memeriksa batas yang sama.
 */
export function atribusiPotonganKlinik(input: {
  rincianPromo: readonly RincianPromoKlinik[];
  voucher: number;
  golongan: number;
  discount: number;
}): AtribusiKlinik {
  const batas = Math.max(0, sen(input.discount));
  const promo = input.rincianPromo.filter((row) => sen(row.potongan) > 0 && !!row.promoId);
  const bagian = [
    ...promo.map((row) => sen(row.potongan)),
    Math.max(0, sen(input.voucher)),
    Math.max(0, sen(input.golongan)),
  ];
  const jumlah = bagian.reduce((a, b) => a + b, 0);
  // Pembagian memakai pembulatan ke bawah supaya totalnya tidak pernah melewati
  // batas gara-gara pembulatan sen.
  const skala = (nilai: number) => (jumlah <= batas ? nilai : Math.floor((nilai * batas) / jumlah));

  const baris = new Map<number, AtribusiBaris>();
  promo.forEach((row, index) => {
    const nilai = skala(bagian[index]);
    if (nilai > 0) baris.set(row.lineIndex, { promo_id: row.promoId, promo_discount: nilai / 100 });
  });
  return {
    baris,
    voucher_discount: skala(bagian[bagian.length - 2]) / 100,
    diskon_kategori: skala(bagian[bagian.length - 1]) / 100,
  };
}
