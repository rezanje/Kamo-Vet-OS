// Aturan bersama dokumen cetak satu kedatangan (struk gabungan & invoice gabungan).
// Dipisah supaya "tagihan mana yang ikut", "kapan menolak mencetak", dan "kop cabang mana"
// ditulis SATU kali — struk dan invoice tidak boleh berbeda pendapat tentang rombongan.
// Murni; dites di __tests__/rombongan-cetak.test.ts

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

/** Semua nomor tagihan aktif rombongan, tanpa duplikat, urut kemunculan. Rawat inap bertahap: lebih dari satu per kunjungan. */
export function nomorTagihanRombongan(baris: readonly { invoiceNo: string | null; invoiceNos?: string[] }[]): string[] {
  return [...new Set(baris.flatMap((b) => b.invoiceNos ?? (b.invoiceNo ? [b.invoiceNo] : [])).filter(Boolean) as string[])];
}

/**
 * Hasil pembacaan rincian tagihan hanya dipercaya bila UTUH: tanpa galat, berupa daftar, jumlahnya sama dengan yang
 * diminta, tiap nomor sekali saja, dan tidak ada nomor di luar yang diminta. Bacaan gagal atau terpotong BUKAN
 * "rombongan belum ditagih" — dokumen ditahan.
 */
export function rincianTagihanUtuh(nomorDiminta: readonly string[], rows: unknown, error: unknown): boolean {
  if (nomorDiminta.length === 0) return true;
  if (error || !Array.isArray(rows)) return false;
  const diminta = new Set(nomorDiminta);
  if (rows.length !== nomorDiminta.length) return false;
  const nomor = rows.map((r) => (r as { invoice_no?: unknown } | null)?.invoice_no);
  if (new Set(nomor).size !== nomorDiminta.length) return false;
  return !nomor.some((n) => typeof n !== "string" || !diminta.has(n));
}

/**
 * Cabang yang identitasnya (alamat/telepon/logo) boleh dicetak di kop. Kop = identitas CABANG PENERBIT tagihan:
 * semua tagihan satu cabang → cabang itu; beda cabang → null (hanya daftar nama, tanpa alamat/telepon/logo);
 * tanpa tagihan sama sekali → cabang kunjungan acuan.
 */
export function idCabangKopRombongan(
  nomorTagihan: readonly string[],
  tagihan: readonly { visits: Rel<{ branch_id?: string | null }> }[],
  cabangAcuan: string | null | undefined,
): string | null {
  if (nomorTagihan.length === 0) return cabangAcuan ?? null;
  const ids = new Set(tagihan.map((t) => one(t.visits)?.branch_id ?? null));
  return ids.size === 1 ? [...ids][0] : null;
}

/** Selisih rupiah yang masih dianggap sama (pembulatan sen). */
const TOLERANSI = 0.005;

/**
 * Total semua tagihan yang dicetak harus sama dengan jumlah total tiap tagihan. Dua pembacaan terpisah (daftar
 * rombongan dan rincian tagihan) yang tidak cocok berarti datanya berubah di tengah jalan atau tidak utuh:
 * dokumen ditahan, bukan dicetak dengan dua angka berbeda.
 */
export function totalGabunganCocok(totalDaftar: number, totalPerTagihan: readonly number[]): boolean {
  const jumlah = totalPerTagihan.reduce((a, b) => a + (Number(b) || 0), 0);
  return Math.abs(jumlah - (Number(totalDaftar) || 0)) < TOLERANSI;
}

/** Tombol dokumen gabungan hanya ada bila pemilik membawa lebih dari satu hewan (aturan yang sama dengan panel rombongan). */
export function punyaRombongan(baris: readonly unknown[] | null | undefined): boolean {
  return (baris?.length ?? 0) > 1;
}

/**
 * Uang yang sudah diterima satu tagihan dan sisanya — rumus yang sama dengan invoice satuan:
 * DP di kepala tagihan + semua baris pembayaran; tagihan Lunas selalu bersisa 0.
 */
export function sisaTagihan(
  tagihan: { total: number | string | null; dp_amount: number | string | null; paid_status: string },
  pembayaran: readonly { amount: number | string | null }[],
): { lunas: boolean; diterima: number; sisa: number } {
  const lunas = tagihan.paid_status === "Lunas";
  const diterima = Number(tagihan.dp_amount || 0) + pembayaran.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  return { lunas, diterima, sisa: lunas ? 0 : Math.max(0, (Number(tagihan.total) || 0) - diterima) };
}
