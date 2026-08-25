import { createClient } from "@/lib/supabase/server";
import { BukuPembantu } from "@/components/BukuPembantu";
import { bukuPembantu } from "@/lib/buku-pembantu";
import { mutasiHutang } from "@/lib/buku-pembantu-server";
import { getAccountOpening, getAccountLedger } from "@/lib/ledger";
import { hariIniWIB } from "@/lib/tanggal";

// Buku Besar Pembantu Hutang — permintaan Kamo Group 24 Agu 2026, menjawab
// "buku besar pembantu utang" dan "history utang" sekaligus.

const awalBulan = () => hariIniWIB().slice(0, 8) + "01";

export default async function PembantuHutangPage({
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
    mutasiHutang(supabase, sampai),
    getAccountOpening(supabase, "2101", { from: dari }),
    getAccountLedger(supabase, "2101", { from: dari, to: sampai }),
  ]);
  // Hutang bersaldo normal kredit — arah saldonya dibalik supaya sejajar dengan
  // buku pembantu yang menghitung hutang sebagai angka positif.
  const saldoBukuBesar = lines.reduce((a, l) => a + l.credit - l.debit, opening);

  const semua = bukuPembantu(mutasi, dari, sampai);
  const baris = cari ? semua.filter((b) => b.pihak.toLowerCase().includes(cari)) : semua;

  return (
    <BukuPembantu
      icon="ti-book-2" title="BUKU BESAR PEMBANTU HUTANG"
      desc="Riwayat hutang per pemasok: saldo awal, tiap faktur pembelian dan tiap pembayaran, sampai saldo akhir."
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
            <label className="flab">Cari pemasok</label>
            <input className="fi" name="cari" defaultValue={sp.cari ?? ""} placeholder="nama pemasok" />
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      baris={baris}
      labelPihak="Pemasok" labelNaik="Faktur masuk" labelTurun="Dibayar & retur"
      kodeAkun="2101" namaAkun="Hutang Usaha" saldoBukuBesar={saldoBukuBesar}
      dari={dari} sampai={sampai}
      catatan={
        <>
          Hutang lahir saat faktur pembelian terbit, bukan saat barang datang — pesanan yang sudah
          diterima tapi belum difakturkan berdiri di akun terpisah dan tidak muncul di sini.
          Pembayaran yang diambil dari uang muka ditandai tersendiri supaya tidak terbaca sebagai
          uang keluar dua kali.<br />
          Pembandingan dengan akun 2101 di atas memakai saldo se-perusahaan, tanpa filter cabang.
        </>
      }
    />
  );
}
