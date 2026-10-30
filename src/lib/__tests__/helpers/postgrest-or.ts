type Row = Record<string, unknown>;

/**
 * Penilai `.or("kolom.op.nilai,kolom.op.nilai")` ala PostgREST untuk klien palsu
 * di tes. Dipakai agar saringan "penugasan belum berakhir" benar-benar diterapkan
 * di fixture, bukan diabaikan diam-diam.
 */
export function cocokOr(row: Row, ekspresi: string): boolean {
  return ekspresi.split(",").some((bagian) => {
    const [kolom, operator, ...sisa] = bagian.split(".");
    const nilai = sisa.join(".");
    const isi = row[kolom];
    switch (operator) {
      case "is": return nilai === "null" ? isi === null || isi === undefined : String(isi) === nilai;
      case "gte": return isi != null && String(isi) >= nilai;
      case "lte": return isi != null && String(isi) <= nilai;
      case "eq": return String(isi) === nilai;
      default: throw new Error(`Operator .or() belum didukung di tes: ${operator}`);
    }
  });
}
