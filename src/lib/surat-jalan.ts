// Surat jalan permintaan barang: dokumen yang ikut di mobil dari gudang ke toko.
// Isinya HARUS sama dengan yang benar-benar keluar dari stok gudang (qty_dikirim),
// bukan yang diminta toko — selisih itulah yang nanti dicek penerima.

export const STATUS_BISA_CETAK_SURAT_JALAN = ["Dikirim", "Selesai"] as const;

export function bisaCetakSuratJalan(status: string | null | undefined): boolean {
  return (STATUS_BISA_CETAK_SURAT_JALAN as readonly string[]).includes(status ?? "");
}

export type ItemSuratJalan = {
  id: string;
  nama: string;
  satuan: string | null;
  qty_diminta: number | string | null;
  qty_disetujui: number | string | null;
  qty_dikirim: number | string | null;
};

export type BarisSuratJalan = { id: string; nama: string; satuan: string | null; qty: number };

const angka = (v: number | string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Baris yang dicetak + barang yang tidak ikut terkirim (qty kirim 0).
 * Kiriman lama (sebelum jumlah kirim dicatat) jatuh ke qty disetujui, lalu qty diminta —
 * urutan yang sama dengan form terima barang di cabang.
 */
export function susunSuratJalan(items: ItemSuratJalan[]): { baris: BarisSuratJalan[]; tidakDikirim: string[] } {
  const baris: BarisSuratJalan[] = [];
  const tidakDikirim: string[] = [];
  for (const it of items) {
    const qty = angka(it.qty_dikirim) ?? angka(it.qty_disetujui) ?? angka(it.qty_diminta) ?? 0;
    if (qty > 0) baris.push({ id: it.id, nama: it.nama, satuan: it.satuan, qty });
    else tidakDikirim.push(it.nama);
  }
  return { baris, tidakDikirim };
}
