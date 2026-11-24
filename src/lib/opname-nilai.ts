// SO-SURPLUS-HPP: ringkasan nilai selisih opname (kurang, lebih, neto) untuk layar hasil dan pesan sukses.
// Selisih lebih dinilai HPP rata-rata barang di gudang itu dan mengurangi Beban Selisih Stok (sisanya Pendapatan Lain-lain).
import Decimal from "decimal.js";

export type NilaiOpname = {
  kurang: string; lebih: string; neto: string; arah: "kurang" | "lebih" | "nol";
  tanpaHarga: { name: string; qty: string }[];
};

const dec = (v: unknown): Decimal | null => {
  if (v === null || v === undefined || v === "") return null;
  try { const d = new Decimal(String(v)); return d.isFinite() ? d : null; } catch { return null; }
};
const rp = (d: Decimal | string) => "Rp " + Math.round(Number(d)).toLocaleString("id-ID");

function tanpaHargaDari(v: unknown): { name: string; qty: string }[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const row = x as Record<string, unknown>;
    return typeof row.name === "string" && row.name ? [{ name: row.name, qty: String(row.qty ?? "") }] : [];
  });
}

function susun(kurang: Decimal, lebih: Decimal, tanpaHarga: { name: string; qty: string }[]): NilaiOpname {
  const neto = kurang.minus(lebih);
  return { kurang: kurang.toFixed(2), lebih: lebih.toFixed(2), neto: neto.abs().toFixed(2), arah: neto.gt(0) ? "kurang" : neto.lt(0) ? "lebih" : "nol", tanpaHarga };
}

/** Dari kuitansi post_opname_atomic (kunci baru; kuitansi lama tanpa kunci ini menghasilkan null). */
export function nilaiDariKuitansi(receipt: unknown): NilaiOpname | null {
  if (!receipt || typeof receipt !== "object") return null;
  const r = receipt as Record<string, unknown>;
  const kurang = dec(r.shortage_value), lebih = dec(r.surplus_value);
  if (!kurang || !lebih || kurang.isNeg() || lebih.isNeg()) return null;
  return susun(kurang, lebih, tanpaHargaDari(r.surplus_unpriced));
}

/** Dari foto laporan harga (read_opname_price_report): jumlahkan nilai modal baris lebih dan baris kurang. */
export function nilaiDariLaporanHarga(report: unknown): NilaiOpname | null {
  if (!report || typeof report !== "object") return null;
  const rows = (report as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return null;
  let kurang = new Decimal(0), lebih = new Decimal(0);
  const tanpa: { name: string; qty: string }[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const selisih = dec(row.selisih), nilai = dec(row.nilai_selisih_modal);
    if (!selisih || !nilai) return null;
    if (selisih.gt(0)) { lebih = lebih.plus(nilai); if (nilai.isZero() && typeof row.name === "string") tanpa.push({ name: row.name, qty: selisih.toString() }); }
    else if (selisih.lt(0)) kurang = kurang.plus(nilai.abs());
  }
  return susun(kurang, lebih, tanpa);
}

/** Kalimat untuk pesan sukses / banner. tampilNilai=false (layar kasir) hanya memuat peringatan barang tanpa harga. */
export function kalimatNilaiOpname(n: NilaiOpname | null, tampilNilai: boolean): string {
  if (!n) return "";
  const bagian: string[] = [];
  const ada = !(new Decimal(n.kurang).isZero() && new Decimal(n.lebih).isZero());
  if (tampilNilai && ada) {
    const neto = n.arah === "kurang" ? `neto kurang ${rp(n.neto)} (Beban Selisih Stok)` : n.arah === "lebih" ? `neto lebih ${rp(n.neto)} (Pendapatan Lain-lain)` : "neto Rp 0";
    bagian.push(`Nilai selisih: kurang ${rp(n.kurang)}, lebih ${rp(n.lebih)} (HPP rata-rata, mengurangi beban selisih kurang), ${neto}.`);
  }
  if (n.tanpaHarga.length) {
    const nama = n.tanpaHarga.slice(0, 5).map((x) => x.name).join(", ") + (n.tanpaHarga.length > 5 ? `, dan ${n.tanpaHarga.length - 5} lainnya` : "");
    bagian.push(`Perhatian: ${n.tanpaHarga.length} barang selisih lebih belum punya harga sama sekali, masuk stok dengan nilai Rp 0 (${nama}). Isi harga beli atau catat pembelian barang itu, lalu minta koreksi nilai ke Finance.`);
  }
  return bagian.length ? " " + bagian.join(" ") : "";
}
