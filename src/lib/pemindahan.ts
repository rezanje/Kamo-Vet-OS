// Logika murni Pemindahan Barang (kloning Accurate) — dites di __tests__/pemindahan.test.ts

export type StatusKirim = "Sedang dikirim" | "Diterima Sebagian" | "Diterima Seluruhnya";

// Nomor dokumen format Accurate: IT.YYYY.MM.NNNNN (seq per bulan).
export function formatNoPemindahan(date: Date, seq: number): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `IT.${y}.${m}.${String(seq).padStart(5, "0")}`;
}

// Status dokumen Kirim berdasarkan total qty dikirim vs total qty sudah diterima.
export function hitungStatusKirim(totalDikirim: number, totalDiterima: number): StatusKirim {
  if (totalDiterima <= 0) return "Sedang dikirim";
  if (totalDiterima >= totalDikirim) return "Diterima Seluruhnya";
  return "Diterima Sebagian";
}

// Sisa qty per item yang masih di Transit untuk satu dokumen Kirim.
// dikirim: qty per item_id; diterima: akumulasi qty per item_id dari semua dokumen Terima.
export function sisaTransit(
  dikirim: Record<string, number>,
  diterima: Record<string, number>,
): Record<string, number> {
  const sisa: Record<string, number> = {};
  for (const [itemId, qty] of Object.entries(dikirim)) {
    const rem = qty - (diterima[itemId] ?? 0);
    if (rem > 0) sisa[itemId] = rem;
  }
  return sisa;
}

// Kekurangan stok gudang asal, dihitung sebelum form dikirim.
//
// Database sudah menolak pemindahan melebihi stok, tapi penolakan itu baru
// terjadi setelah tombol ditekan. Petugas gudang perlu tahu lebih dulu, dan
// dengan angka per barang — bukan sekadar "stok tidak cukup".
export type BarisPindah = { item_id: string; nama: string; qty: number; faktor: number; satuan: string };

export function kurangStokPemindahan(
  rows: BarisPindah[],
  stokDasarPerItem: Map<string, number>,
): string | null {
  const perItem = new Map<string, { nama: string; satuan: string; faktor: number; butuh: number; ada: number }>();
  for (const r of rows) {
    if (!r.item_id || !(r.qty > 0)) continue;
    const faktor = Number(r.faktor) > 0 ? Number(r.faktor) : 1;
    const ada = perItem.get(r.item_id);
    if (ada) ada.butuh += r.qty * faktor;
    else perItem.set(r.item_id, {
      nama: r.nama, satuan: r.satuan, faktor,
      butuh: r.qty * faktor,
      ada: Math.max(0, Number(stokDasarPerItem.get(r.item_id)) || 0),
    });
  }
  const angka = (v: number) => Number(v.toFixed(6)).toLocaleString("id-ID", { maximumFractionDigits: 6 });
  const kurang = [...perItem.values()].filter((t) => t.butuh > t.ada + 1e-9);
  if (!kurang.length) return null;
  return kurang
    .map((t) => `${t.nama} butuh ${angka(t.butuh / t.faktor)} ${t.satuan}, tersedia ${angka(t.ada / t.faktor)} ${t.satuan}`.trimEnd())
    .join("; ");
}
