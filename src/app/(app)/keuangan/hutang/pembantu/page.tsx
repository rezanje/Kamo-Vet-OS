import { createClient } from "@/lib/supabase/server";
import { BukuPembantu } from "@/components/BukuPembantu";
import { bukuPembantu } from "@/lib/buku-pembantu";
import { mutasiHutang } from "@/lib/buku-pembantu-server";
import { getAccountOpening, getAccountLedger } from "@/lib/ledger";
import { hariIniWIB } from "@/lib/tanggal";
import { laporanDiminta } from "@/lib/report-gate";
import type { LedgerLine } from "@/lib/ledger";

// Buku Besar Pembantu Hutang — permintaan Kamo Group 24 Agu 2026, menjawab
// "buku besar pembantu utang" dan "history utang" sekaligus.

const awalBulan = () => hariIniWIB().slice(0, 8) + "01";

export default async function PembantuHutangPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string; cari?: string; tampil?: string }>;
}) {
  const sp = await searchParams;
  // A1 (meeting 12 Nov 2026): mutasi & saldo buku besar baru dibaca setelah Tampilkan ditekan.
  const siap = laporanDiminta(sp);
  const dari = sp.dari || awalBulan();
  const sampai = sp.sampai || hariIniWIB();
  const cari = (sp.cari || "").trim().toLowerCase();

  const supabase = await createClient();
  const [mutasi, opening, lines] = await Promise.all([
    siap ? mutasiHutang(supabase, sampai) : [],
    siap ? getAccountOpening(supabase, "311001", { from: dari }) : 0,
    siap ? getAccountLedger(supabase, "311001", { from: dari, to: sampai }) : ([] as LedgerLine[]),
  ]);
  // Hutang bersaldo normal kredit — arah saldonya dibalik supaya sejajar dengan
  // buku pembantu yang menghitung hutang sebagai angka positif.
  const saldoBukuBesar = lines.reduce((a, l) => a + l.credit - l.debit, opening);

  const semua = bukuPembantu(mutasi, dari, sampai);
  const baris = cari ? semua.filter((b) => b.pihak.toLowerCase().includes(cari)) : semua;

  return (
    <BukuPembantu
      siap={siap}
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
      kodeAkun="311001" namaAkun="Hutang Usaha" saldoBukuBesar={saldoBukuBesar}
      dari={dari} sampai={sampai}
      catatan={
        <>
          Hutang lahir saat faktur pembelian terbit, bukan saat barang datang — pesanan yang sudah
          diterima tapi belum difakturkan berdiri di akun terpisah dan tidak muncul di sini.
          Pembayaran yang diambil dari uang muka ditandai tersendiri supaya tidak terbaca sebagai
          uang keluar dua kali.<br />
          Pembandingan dengan akun 311001 di atas memakai saldo se-perusahaan, tanpa filter cabang.
        </>
      }
    />
  );
}
