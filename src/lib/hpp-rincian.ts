export type BarisFakturHpp = {
  orderItemId: string | null;
  nama: string;
  qty: number;
  satuan: string | null;
};

export type BarisKirimanHpp = {
  orderItemId: string | null;
  qty: number;
  hpp: number | null;
};

export type RincianHpp = {
  nama: string;
  qty: number;
  satuan: string;
  hpp: number;
};

export function alokasiHppFaktur(o: {
  orderItemId: string;
  qtySudahFaktur: number;
  qtyFakturBaru: number;
  kiriman: BarisKirimanHpp[];
}): number {
  let lewati = Math.max(0, Number(o.qtySudahFaktur) || 0);
  let ambil = Math.max(0, Number(o.qtyFakturBaru) || 0);
  let total = 0;

  for (const baris of o.kiriman) {
    if (baris.orderItemId !== o.orderItemId || ambil <= 0) continue;
    const qty = Math.max(0, Number(baris.qty) || 0);
    if (qty <= 0) continue;
    const biayaSatuan = (Number(baris.hpp ?? 0) || 0) / qty;
    const dilewati = Math.min(lewati, qty);
    lewati -= dilewati;
    const tersedia = qty - dilewati;
    const dipakai = Math.min(ambil, tersedia);
    total += dipakai * biayaSatuan;
    ambil -= dipakai;
  }

  return Math.round(total * 100) / 100;
}

/** Alokasikan modal FIFO semua kiriman pesanan ke qty pada satu faktur. */
export function rincianHppFaktur(
  faktur: BarisFakturHpp[],
  kiriman: BarisKirimanHpp[],
): RincianHpp[] {
  const biayaPerBaris = new Map<string, { qty: number; hpp: number }>();
  for (const baris of kiriman) {
    if (!baris.orderItemId) continue;
    const qty = Number(baris.qty);
    const hpp = Number(baris.hpp ?? 0);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(hpp)) continue;
    const current = biayaPerBaris.get(baris.orderItemId) ?? { qty: 0, hpp: 0 };
    current.qty += qty;
    current.hpp += hpp;
    biayaPerBaris.set(baris.orderItemId, current);
  }

  return faktur.map((baris) => {
    const biaya = baris.orderItemId ? biayaPerBaris.get(baris.orderItemId) : undefined;
    const qty = Number(baris.qty);
    const hpp = biaya && biaya.qty > 0 ? qty * biaya.hpp / biaya.qty : 0;
    return {
      nama: baris.nama,
      qty,
      satuan: baris.satuan || "unit",
      hpp,
    };
  });
}
