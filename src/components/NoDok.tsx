import Link from "next/link";
import { hrefDokumen, hrefNomorModul, hrefPerintahProduksi, tampakNomorDokumen, tautanSumberJurnal } from "@/lib/tautan-dokumen";

/**
 * Nomor dokumen yang bisa diklik di mana pun (permintaan meeting 14 Agustus).
 * Teks yang bukan nomor dokumen tetap tampil apa adanya — keterangan bebas
 * seperti "bayar listrik" tidak boleh berubah jadi tautan yang buntu.
 */
export function NoDok({
  nomor,
  source,
  style,
}: {
  nomor: string | null | undefined;
  source?: string;
  style?: React.CSSProperties;
}) {
  const teks = (nomor ?? "").trim();
  if (!teks) return <span style={style}>—</span>;
  // Jurnal yang sumbernya dicatat dengan id (mis. pengeluaran kasir) — tampilkan nama
  // transaksinya dan sambungkan ke layar yang bisa mengoreksinya.
  const sumber = tautanSumberJurnal(source, teks);
  if (sumber) {
    return (
      <Link href={sumber.href} title={teks} style={{ color: "#2563eb", textDecoration: "none", ...style }}>
        {sumber.label}
      </Link>
    );
  }
  const savedProduction = source === "produksi" && teks.length <= 30 && !/[\u0000-\u001f\u007f]/.test(teks);
  if (!savedProduction && !tampakNomorDokumen(teks)) return <span style={style}>{teks}</span>;
  return (
    <Link href={savedProduction ? hrefPerintahProduksi(teks) : hrefNomorModul(teks) ?? hrefDokumen(teks)} style={{ color: "#2563eb", textDecoration: "none", ...style }}>
      {teks}
    </Link>
  );
}
