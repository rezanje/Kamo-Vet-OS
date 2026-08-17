import Link from "next/link";
import { hrefDokumen, tampakNomorDokumen } from "@/lib/tautan-dokumen";

/**
 * Nomor dokumen yang bisa diklik di mana pun (permintaan meeting 14 Agustus).
 * Teks yang bukan nomor dokumen tetap tampil apa adanya — keterangan bebas
 * seperti "bayar listrik" tidak boleh berubah jadi tautan yang buntu.
 */
export function NoDok({
  nomor,
  style,
}: {
  nomor: string | null | undefined;
  style?: React.CSSProperties;
}) {
  const teks = (nomor ?? "").trim();
  if (!teks) return <span style={style}>—</span>;
  if (!tampakNomorDokumen(teks)) return <span style={style}>{teks}</span>;
  return (
    <Link href={hrefDokumen(teks)} style={{ color: "#2563eb", textDecoration: "none", ...style }}>
      {teks}
    </Link>
  );
}
