// Hitungan komisi penjual (migrasi 0091) — murni, dites di __tests__/komisi.test.ts.
//
// Masukan: baris penjualan satu periode (retur ikut, bernilai negatif) + aturan komisi.
// Keluaran: per karyawan — omzet, laba, komisi, dan rincian per aturan supaya angkanya
// bisa ditelusuri, bukan cuma satu total yang harus dipercaya begitu saja.

export type BarisJual = {
  tanggal: string;              // YYYY-MM-DD
  // null = struknya tidak terhubung ke karyawan mana pun. Barisnya tetap dibawa
  // supaya realisasi target per cabang/kategori tidak kehilangan omzet, tapi
  // tidak ikut dihitung komisinya.
  employeeId: string | null;
  branchId: string | null;
  itemId: string | null;
  kategoriIds: string[];        // kategori barang + induknya
  qty: number;                  // negatif untuk baris retur
  omzet: number;                // negatif untuk baris retur
  laba: number | null;          // null = HPP tidak diketahui
};

export type AturanKomisi = {
  id: string;
  nama: string;
  tipe: "persen" | "nominal";
  basis: "omzet" | "laba";
  persen: number;
  nominal: number;              // rupiah per unit terjual
  employeeId: string | null;
  branchId: string | null;
  categoryId: string | null;
  itemId: string | null;
  minOmzet: number;
  dari: string | null;
  sampai: string | null;
};

export type RincianAturan = {
  aturanId: string;
  nama: string;
  dasar: number;                // omzet/laba yang kena aturan ini, atau qty untuk tipe nominal
  komisi: number;               // 0 kalau ambang belum terlewati
  cair: boolean;
};

export type HasilKomisi = {
  employeeId: string;
  omzet: number;
  laba: number;                 // hanya dari baris yang HPP-nya diketahui
  barisTanpaHpp: number;
  komisi: number;
  rincian: RincianAturan[];
};

export type TargetPenjualan = {
  id: string;
  employeeId: string | null;
  branchId: string | null;
  categoryId: string | null;
  basis: "omzet" | "laba";
  target: number;
};

/**
 * Realisasi satu target dari baris penjualan periode itu. Cakupan yang null =
 * semua, sama seperti aturan komisi. Baris tanpa penjual tetap dihitung untuk
 * target cabang/kategori — omzetnya nyata, cuma belum bisa dinisbahkan ke orang.
 */
export function realisasiTarget(baris: BarisJual[], t: TargetPenjualan): { realisasi: number; persen: number } {
  const kena = baris.filter((b) =>
    (!t.employeeId || t.employeeId === b.employeeId) &&
    (!t.branchId || t.branchId === b.branchId) &&
    (!t.categoryId || b.kategoriIds.includes(t.categoryId)));

  const realisasi = Math.round(
    t.basis === "laba"
      ? kena.reduce((s, b) => s + (b.laba ?? 0), 0)
      : kena.reduce((s, b) => s + b.omzet, 0),
  );
  return { realisasi, persen: t.target > 0 ? Math.round((realisasi / t.target) * 100) : 0 };
}

function cocok(b: BarisJual, a: AturanKomisi): boolean {
  if (a.employeeId && a.employeeId !== b.employeeId) return false;
  if (a.branchId && a.branchId !== b.branchId) return false;
  if (a.itemId && a.itemId !== b.itemId) return false;
  // Kategori induk ikut menjaring produk di kategori anaknya — kategoriIds sudah
  // berisi rantai kategori barang itu.
  if (a.categoryId && !b.kategoriIds.includes(a.categoryId)) return false;
  if (a.dari && b.tanggal < a.dari) return false;
  if (a.sampai && b.tanggal > a.sampai) return false;
  return true;
}

export function hitungKomisi(baris: BarisJual[], aturan: AturanKomisi[]): HasilKomisi[] {
  const perOrang = new Map<string, BarisJual[]>();
  for (const b of baris) {
    if (!b.employeeId) continue;
    const arr = perOrang.get(b.employeeId) ?? [];
    arr.push(b);
    perOrang.set(b.employeeId, arr);
  }

  const hasil: HasilKomisi[] = [];

  for (const [employeeId, milikDia] of perOrang) {
    const omzet = milikDia.reduce((a, b) => a + b.omzet, 0);
    const laba = milikDia.reduce((a, b) => a + (b.laba ?? 0), 0);
    const barisTanpaHpp = milikDia.filter((b) => b.laba === null).length;

    const rincian: RincianAturan[] = [];

    for (const a of aturan) {
      const kena = milikDia.filter((b) => cocok(b, a));
      if (kena.length === 0) continue;

      let dasar = 0;
      let komisi = 0;

      if (a.tipe === "nominal") {
        // Rupiah tetap per unit — tidak butuh HPP, jadi basisnya tidak dipakai.
        dasar = kena.reduce((s, b) => s + b.qty, 0);
        komisi = dasar * a.nominal;
      } else if (a.basis === "laba") {
        // Baris tanpa HPP dilewati, bukan dianggap laba penuh — itu akan melebihkan komisi.
        const berHpp = kena.filter((b) => b.laba !== null);
        dasar = berHpp.reduce((s, b) => s + (b.laba as number), 0);
        komisi = (dasar * a.persen) / 100;
      } else {
        dasar = kena.reduce((s, b) => s + b.omzet, 0);
        komisi = (dasar * a.persen) / 100;
      }

      // Ambang diukur dari realisasi karyawan sebulan, bukan dari baris yang kena aturan —
      // "komisi cair kalau bulan ini tembus sekian" memang maksudnya begitu.
      const realisasi = a.basis === "laba" ? laba : omzet;
      const cair = a.minOmzet <= 0 || realisasi >= a.minOmzet;

      // Komisi negatif (retur melebihi penjualan) ditahan di nol: gaji orang tidak
      // dipotong gara-gara komisi, potongan retur diurus terpisah kalau memang perlu.
      const nilai = cair ? Math.max(0, Math.round(komisi)) : 0;
      rincian.push({ aturanId: a.id, nama: a.nama, dasar: Math.round(dasar), komisi: nilai, cair });
    }

    hasil.push({
      employeeId,
      omzet: Math.round(omzet),
      laba: Math.round(laba),
      barisTanpaHpp,
      komisi: rincian.reduce((s, r) => s + r.komisi, 0),
      rincian,
    });
  }

  return hasil;
}
