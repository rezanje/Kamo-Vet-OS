import { createClient } from "@/lib/supabase/server";
import { BukuPembantu } from "@/components/BukuPembantu";
import { bukuPembantu } from "@/lib/buku-pembantu";
import { mutasiPiutang } from "@/lib/buku-pembantu-server";
import { getAccountOpening, getAccountLedger } from "@/lib/ledger";
import { hariIniWIB } from "@/lib/tanggal";

// Buku Besar Pembantu Piutang — permintaan Kamo Group 24 Agu 2026.
// Menjawab dua baris sekaligus di daftar mereka: "buku besar pembantu piutang"
// dan "history piutang" — keduanya pertanyaan yang sama, cuma beda sebutan.

const awalBulan = () => hariIniWIB().slice(0, 8) + "01";

export default async function PembantuPiutangPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string; cari?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || awalBulan();
  const sampai = sp.sampai || hariIniWIB();
  const cari = (sp.cari || "").trim().toLowerCase();

  const supabase = await createClient();
  const [mutasi, opening, lines] = await Promise.all([
    mutasiPiutang(supabase, sampai),
    getAccountOpening(supabase, "1201", { from: dari }),
    getAccountLedger(supabase, "1201", { from: dari, to: sampai }),
  ]);
  const saldoBukuBesar = lines.reduce((a, l) => a + l.debit - l.credit, opening);

  const semua = bukuPembantu(mutasi, dari, sampai);
  const baris = cari ? semua.filter((b) => b.pihak.toLowerCase().includes(cari)) : semua;

  return (
    <BukuPembantu
      icon="ti-book-2" title="BUKU BESAR PEMBANTU PIUTANG"
      desc="Riwayat piutang per pelanggan: saldo awal, tiap tagihan dan tiap pembayaran, sampai saldo akhir."
      filter={
        <>
          <div>
            <label className="flab">Dari tanggal</label>
            <input className="fi" type="date" name="dari" defaultValue={dari} />
          </div>
          <div>
            <label className="flab">Sampai tanggal</label>
            <input className="fi" type="date" name="sampai" defaultValue={sampai} />
          </div>
          <div style={{ minWidth: 200 }}>
            <label className="flab">Cari pelanggan</label>
            <input className="fi" name="cari" defaultValue={sp.cari ?? ""} placeholder="nama pelanggan" />
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      baris={baris}
      labelPihak="Pelanggan" labelNaik="Tagihan terbit" labelTurun="Pembayaran masuk"
      kodeAkun="1201" namaAkun="Piutang Usaha" saldoBukuBesar={saldoBukuBesar}
      dari={dari} sampai={sampai}
      catatan={
        <>
          Sumbernya dua pintu: tagihan klinik dan faktur penjualan reseller — keduanya masuk akun
          piutang yang sama. Tagihan yang dibayar langsung di kasir klinik tidak meninggalkan
          catatan pembayaran tersendiri, jadi dicatat di sini sebagai &quot;dibayar di kasir klinik&quot;
          pada tanggal lunasnya supaya sisanya tidak menggantung.<br />
          Pembandingan dengan akun 1201 di atas memakai saldo se-perusahaan, tanpa filter cabang.
          Kalau ada selisih, telusuri dari jurnal manual yang menyentuh piutang tapi tidak berasal
          dari faktur mana pun.
        </>
      }
    />
  );
}
