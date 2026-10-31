import type { CSSProperties } from "react";
import { faktorSatuanKlinik, keadaanStok, teksStok, type PetaStokKlinik, type StatusStok, type StokDasar } from "@/lib/stok-klinik";

const WARNA: Record<StatusStok, string> = {
  "belum-terbaca": "#b45309", "tanpa-konversi": "#b45309", habis: "#b91c1c", kurang: "#b91c1c", cukup: "var(--tm)",
};

/** Satu teks stok untuk semua jalur input klinik. Lihat `@/lib/stok-klinik`. */
export function StokKlinik({ stok, satuanDasar, satuan, faktor, butuh, nama, style }: {
  stok: StokDasar; satuanDasar: string; satuan?: string | null; faktor?: number | null; butuh?: number | null;
  /** Awalan nama barang, untuk baris bahan/BMHP di bawah tindakan. */
  nama?: string; style?: CSSProperties;
}) {
  const k = keadaanStok({ stok, satuanDasar, satuan, faktor, butuh });
  const judul = k.status === "belum-terbaca"
    ? "Stok gudang klinik cabang ini belum terbaca. Stok tetap diperiksa saat tagihan disimpan."
    : k.status === "tanpa-konversi" ? "Faktor satuan ini belum ada di master barang." : undefined;
  return <span data-stok-klinik={k.status} title={judul}
    style={{ fontSize: 9.5, color: WARNA[k.status], fontWeight: k.status === "cukup" ? 400 : 600, ...style }}>
    {nama ? `${nama}: ` : ""}{teksStok(k)}
  </span>;
}

type BarisKeranjang = {
  item_id: string | null; jenis: string; qty: number; satuan: string; faktor: number;
  bmhp?: { item_id: string; nama: string; qty: number; unit: string }[];
};

/** Stok di bawah baris keranjang klinik (Rekam Medis & OBAT KHUSUS).
 * - Obat / tindakan persediaan tanpa BMHP: stok barangnya dalam satuan baris.
 * - Baris ber-BMHP: stok tiap bahannya — stok induk tindakan persediaan tidak disyaratkan.
 * - Racikan: tidak ada — bahannya keluar saat diracik, tidak dikeluarkan lagi saat ditagih. */
export function StokKeranjangKlinik({ baris, peta }: { baris: BarisKeranjang; peta: PetaStokKlinik }) {
  if (baris.jenis === "racikan") return null;
  const bmhp = baris.bmhp ?? [];
  if (bmhp.length) {
    return <div style={{ display: "flex", flexDirection: "column" }}>
      {bmhp.map(b => {
        const item = peta.get(b.item_id);
        return <StokKlinik key={b.item_id} nama={b.nama} stok={item?.stok ?? null} satuanDasar={item?.unit ?? b.unit}
          satuan={b.unit} faktor={faktorSatuanKlinik(item, b.unit)} butuh={b.qty} />;
      })}
    </div>;
  }
  if (baris.jenis !== "obat" || !baris.item_id) return null;
  const item = peta.get(baris.item_id);
  if (!item) return null;
  return <div><StokKlinik stok={item.stok} satuanDasar={item.unit} satuan={baris.satuan}
    faktor={baris.satuan === item.unit ? 1 : baris.faktor || faktorSatuanKlinik(item, baris.satuan)} butuh={baris.qty} /></div>;
}

/** Stok di bawah baris tagihan Pembayaran — hanya baris yang ditambah/diganti kasir
 * (termasuk item susulan rawat jalan). Baris dari resep tidak diberi angka: tindakan
 * persediaan ber-BMHP tidak memakai stok induknya dan racikan bahannya sudah keluar saat
 * diracik; baris invoice tersimpan stoknya sudah keluar. Jasa tidak membawa `stokGudang`. */
export function StokBarisTagihan({ baris, item }: {
  baris: { item_id?: string | null; satuan?: string | null; qty: number; prescription_item_id?: string | null;
    recipe_id?: string | null; source_invoice_item_id?: string | null; terkunci?: boolean };
  item: { unit: string; stokGudang?: StokDasar; units?: { unit: string; factor: number }[] } | undefined;
}) {
  if (!item || item.stokGudang === undefined || !baris.item_id) return null;
  if (baris.prescription_item_id || baris.recipe_id || baris.source_invoice_item_id || baris.terkunci) return null;
  const satuan = baris.satuan || item.unit;
  return <div><StokKlinik stok={item.stokGudang} satuanDasar={item.unit} satuan={satuan}
    faktor={faktorSatuanKlinik(item, satuan)} butuh={baris.qty} /></div>;
}
