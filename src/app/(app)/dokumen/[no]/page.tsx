import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { PETA_DOKUMEN } from "@/lib/tautan-dokumen";

// Halaman satu pintu: /dokumen/FJ.2026.08.00001 mencari nomor itu ke seluruh tabel
// dokumen lalu melempar ke halaman aslinya. Dengan begini nomor dokumen di laporan,
// jurnal, dan dashboard cukup ditulis sebagai tautan ke sini — tiap layar tidak
// perlu tahu nomor itu milik tabel yang mana.

export default async function CariDokumenPage({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const nomor = decodeURIComponent(no).trim();
  const supabase = await createClient();

  for (const peta of PETA_DOKUMEN) {
    const kolom = peta.extra ? `id, ${peta.extra}` : "id";
    const { data } = await supabase
      .from(peta.tabel).select(kolom).eq(peta.kolom, nomor).maybeSingle();
    if (data) {
      const row = data as unknown as Record<string, string | null>;
      redirect(peta.href({ id: String(row.id), extra: peta.extra ? row[peta.extra] : null }));
    }
  }

  // Tidak ketemu: jangan lempar ke 404 buntu — nomor bisa saja milik dokumen yang
  // sudah dibatalkan atau salah ketik, dan orangnya butuh jalan kembali.
  return (
    <div className="crm-sec" style={{ maxWidth: 560 }}>
      <SecHeader num="01" title="DOKUMEN TIDAK DITEMUKAN" desc={`Tidak ada dokumen bernomor ${nomor}.`} />
      <div style={{ fontSize: 11.5, color: "var(--tm)", marginBottom: 12 }}>
        Nomor ini tidak cocok dengan struk, faktur, pesanan, penerimaan, retur, kas, opname,
        maupun jurnal mana pun. Kemungkinan dokumennya sudah dihapus, atau nomornya salah ketik.
      </div>
      <Link href="/keuangan/jurnal" className="btn-def" style={{ textDecoration: "none" }}>
        <i className="ti ti-arrow-left" /> Ke Jurnal Umum
      </Link>
    </div>
  );
}
