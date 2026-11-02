/**
 * Paket (barang bertipe "Grup") di klinik — permintaan Andri & Anisa, 2 Nov 2026:
 * paket muncul di daftar Obat (rekam medis & pembayaran) dan, saat dipilih, langsung
 * dipecah menjadi isinya. Barang persediaan di dalam paket menjadi baris obat (stoknya
 * dipotong saat tagihan disimpan), jasa di dalam paket menjadi baris jasa. Dengan begitu
 * bahan habis pakai yang sudah ada di resep paket tidak perlu diisi lagi sebagai BMHP.
 *
 * Harga jual paket dibagi ke baris-barisnya (sebanding harga normal tiap isi) sehingga
 * jumlahnya persis harga paket. Di pembayaran baris-baris itu ditandai "asal paket" (H05)
 * sehingga batas harga/HPP, komisi dan omzet dihitung per paket.
 *
 * Modul ini murni hitungan; database tetap memeriksa stok, satuan, isi resep paket dan
 * harga saat tagihan disimpan.
 */

/** Satu isi resep paket, dibaca dari master (item_group_components + barang isinya). */
export type KomponenPaket = {
  item_id: string;
  name: string;
  /** Jenis barang isi: Persediaan / Jasa / Non-Persediaan. */
  item_type: string;
  /** Satuan dasar barang isi. */
  base_unit: string;
  qty: number;
  unit: string;
  factor: number;
  tindakan_kategori?: string | null;
};

export type ResepPaket = { id: string; name: string; komponen: KomponenPaket[] };

/** Baris hasil pecahan satu paket (untuk `jumlah` paket). */
export type BarisPaket = {
  item_id: string;
  nama: string;
  jenis: "obat" | "jasa";
  qty: number;
  satuan: string;
  faktor: number;
  /** Harga per satuan baris (bagian harga paket). */
  harga: number;
  kategori: string | null;
};

export type HasilPecahPaket = { baris: BarisPaket[]; error: null } | { baris: []; error: string };

const bulat = (n: number) => Math.abs(n - Math.round(n)) < 1e-9;

/** Kuantitas satu paket (satuan dasar) per barang isi — yang dicek database (H05). */
export function isiPerPaket(komponen: KomponenPaket[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of komponen) out[k.item_id] = (out[k.item_id] ?? 0) + Number(k.qty) * Number(k.factor);
  return out;
}

/** Isi yang benar-benar menjadi baris tagihan klinik (Persediaan & Jasa), per satu paket. */
export function isiDitagihPerPaket(resep: ResepPaket): Record<string, number> {
  return isiPerPaket(resep.komponen.filter(k => k.item_type === "Persediaan" || k.item_type === "Jasa"));
}

/**
 * Membagi harga paket ke baris-baris isinya. Hasilnya harga per satuan tiap baris
 * (kelipatan Rp1 bila bisa, sen bila terpaksa) dengan Σ qty × harga = total.
 * Bobot = harga normal baris; bila semuanya nol, bobot = qty.
 */
export function bagiHargaPaket(total: number, baris: { qty: number; bobot: number }[]): number[] {
  if (!baris.length) return [];
  const T = Math.max(0, Math.round(total * 100));
  const bobotAsli = baris.map(b => Math.max(0, Number(b.bobot) || 0));
  const totalBobot = bobotAsli.reduce((a, b) => a + b, 0);
  const bobot = totalBobot > 0 ? bobotAsli : baris.map(b => b.qty);
  const W = bobot.reduce((a, b) => a + b, 0);
  // Harga per satuan dalam sen, dibulatkan ke bawah ke rupiah penuh.
  const harga = baris.map((b, i) => Math.floor((T * bobot[i]) / W / b.qty / 100) * 100);
  let sisa = T - baris.reduce((a, b, i) => a + b.qty * harga[i], 0);
  // Sisa diserap baris dengan qty terkecil lebih dulu (qty 1 menyerap berapa pun).
  const urut = baris.map((_, i) => i).sort((a, b) => baris[a].qty - baris[b].qty || a - b);
  for (const i of urut) {
    if (sisa <= 0) break;
    const tambah = Math.floor(sisa / (baris[i].qty * 100)) * 100;
    harga[i] += tambah; sisa -= tambah * baris[i].qty;
  }
  for (const i of urut) {
    if (sisa <= 0) break;
    const tambah = Math.floor(sisa / baris[i].qty);
    harga[i] += tambah; sisa -= tambah * baris[i].qty;
  }
  return harga.map(sen => sen / 100);
}

/**
 * Pecah `jumlah` paket menjadi baris obat/jasa.
 * - Persediaan → baris obat; Jasa → baris jasa; Non-Persediaan dilewati (tidak berstok
 *   dan tidak dapat ditagih di klinik).
 * - Satuan resep dipakai bila qty-nya bulat; selain itu satuan dasar. Barang yang muncul
 *   lebih dari sekali di resep digabung dalam satuan dasar (database membandingkan total).
 * - `hargaSatuan(item_id, satuan, faktor)` = harga normal per satuan baris, untuk bobot.
 * - `satuanDasarSaja`: pembayaran tanpa dukungan satuan manual — semua baris satuan dasar.
 */
export function pecahPaket(
  resep: ResepPaket, hargaPaket: number, jumlah: number,
  hargaSatuan: (itemId: string, satuan: string, faktor: number) => number,
  opsi: { satuanDasarSaja?: boolean } = {},
): HasilPecahPaket {
  const gagal = (error: string): HasilPecahPaket => ({ baris: [], error });
  if (!Number.isInteger(jumlah) || jumlah < 1) return gagal("Jumlah paket harus bilangan bulat minimal 1.");
  const dipakai = resep.komponen.filter(k => k.item_type === "Persediaan" || k.item_type === "Jasa");
  if (!dipakai.length) return gagal(`Paket ${resep.name} tidak berisi obat/barang atau jasa yang bisa ditagih di klinik.`);

  const perBarang = new Map<string, KomponenPaket[]>();
  for (const k of dipakai) perBarang.set(k.item_id, [...(perBarang.get(k.item_id) ?? []), k]);

  const draf: Omit<BarisPaket, "harga">[] = [];
  for (const [itemId, list] of perBarang) {
    const k = list[0];
    const jenis = k.item_type === "Jasa" ? "jasa" : "obat";
    const dasar = list.reduce((a, row) => a + Number(row.qty) * Number(row.factor), 0);
    let qty: number; let satuan: string; let faktor: number;
    if (list.length === 1 && !opsi.satuanDasarSaja && bulat(Number(k.qty))) {
      qty = Math.round(Number(k.qty)); satuan = k.unit; faktor = Number(k.factor);
    } else if (bulat(dasar)) {
      qty = Math.round(dasar); satuan = k.base_unit; faktor = 1;
    } else {
      return gagal(`Isi paket ${resep.name} (${k.name}) bukan bilangan bulat. Ubah resep paket di Barang & Jasa supaya jumlah isinya bulat.`);
    }
    if (qty <= 0) return gagal(`Isi paket ${resep.name} (${k.name}) tidak valid.`);
    draf.push({ item_id: itemId, nama: k.name, jenis, qty, satuan, faktor, kategori: jenis === "jasa" ? k.tindakan_kategori ?? null : null });
  }

  const harga = bagiHargaPaket(Math.max(0, Number(hargaPaket) || 0),
    draf.map(row => ({ qty: row.qty, bobot: row.qty * Math.max(0, Number(hargaSatuan(row.item_id, row.satuan, row.faktor)) || 0) })));
  return { error: null, baris: draf.map((row, i) => ({ ...row, qty: row.qty * jumlah, harga: harga[i] })) };
}

/** Stok paket (berapa paket yang bisa dibuat dari stok isi); null = ada stok yang belum terbaca. */
export function stokPaket(resep: ResepPaket, stokDasar: (itemId: string) => number | null): number | null {
  const per = isiPerPaket(resep.komponen.filter(k => k.item_type === "Persediaan"));
  let hasil = Infinity;
  for (const [itemId, butuh] of Object.entries(per)) {
    const stok = stokDasar(itemId);
    if (stok == null) return null;
    hasil = Math.min(hasil, butuh > 0 ? Math.floor(stok / butuh + 1e-9) : Infinity);
  }
  return Number.isFinite(hasil) ? Math.max(0, hasil) : null;
}

type BarisTagihan = {
  item_id?: string | null; qty: number; satuan?: string | null; harga: number; diskon_persen?: number;
  recipe_id?: string | null; terkunci?: boolean; package_item_id?: string | null; package_qty?: number | null;
};

/**
 * Pembayaran: kenali kembali paket yang dipilih dokter di rekam medis. Rekam medis
 * menyimpan isi paket sebagai baris biasa; bila satu set baris cocok persis dengan resep
 * paket (qty = k × isi, jumlah harga = k × harga paket), baris-baris itu ditandai asal
 * paketnya. Kasir tetap bisa mengubahnya lewat pilihan "Asal paket".
 */
export function kenaliPaket<L extends BarisTagihan>(
  rows: L[],
  paket: { id: string; harga: number | null; perPaket: Record<string, number> }[],
  faktorSatuan: (itemId: string, satuan: string | null | undefined) => number | null,
): L[] {
  const out = rows.map(row => ({ ...row }));
  const bebas = (row: L) => !!row.item_id && !row.recipe_id && !row.terkunci && !row.package_item_id;
  const dasarBaris = (row: L) => {
    const f = faktorSatuan(row.item_id!, row.satuan);
    return f == null ? null : Number(row.qty) * f;
  };
  for (const p of paket) {
    const isi = Object.entries(p.perPaket).filter(([, q]) => q > 0);
    if (!isi.length || p.harga == null || out.some(row => row.package_item_id === p.id)) continue;
    const [pertamaId, pertamaQty] = isi[0];
    for (const calon of out.filter(row => bebas(row) && row.item_id === pertamaId)) {
      const dasar = dasarBaris(calon);
      if (dasar == null) continue;
      const k = dasar / pertamaQty;
      if (!bulat(k) || k < 1) continue;
      const jumlah = Math.round(k);
      const cocok: number[] = [];
      for (const [itemId, q] of isi) {
        const idx = out.findIndex((row, i) => !cocok.includes(i) && bebas(row) && row.item_id === itemId
          && (() => { const d = dasarBaris(row); return d != null && Math.abs(d - jumlah * q) < 1e-6; })());
        if (idx < 0) break;
        cocok.push(idx);
      }
      if (cocok.length !== isi.length) continue;
      const nilai = cocok.reduce((a, i) => a + Number(out[i].qty) * Number(out[i].harga) * (1 - (out[i].diskon_persen ?? 0) / 100), 0);
      if (Math.abs(nilai - jumlah * p.harga) > 0.5) continue;
      for (const i of cocok) out[i] = { ...out[i], package_item_id: p.id, package_qty: jumlah };
      break;
    }
  }
  return out;
}
