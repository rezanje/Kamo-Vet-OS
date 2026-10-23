import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { hariIniWIB } from "@/lib/tanggal";
import Link from "next/link";
import { formatPosMoney } from "@/lib/pos-money";
import { tarikTransaksi } from "@/lib/laporan-transaksi-server";
import { perCabang, perHari, perKanal, rekap, type Kanal, type Trx } from "@/lib/laporan-transaksi";

// Menjawab tiga laporan dasar sekaligus (permintaan Kamo Group 24 Agu 2026):
// jumlah transaksi per cabang, rata-rata transaksi per pelanggan, dan
// rata-rata item per struk. Ketiganya berasal dari kumpulan angka yang sama,
// jadi disajikan dalam satu tabel supaya tidak bisa saling bertentangan.

const rp = formatPosMoney;
const angka = (n: number, desimal = 1) =>
  n.toLocaleString("id-ID", { minimumFractionDigits: desimal, maximumFractionDigits: desimal });

const awalBulan = () => hariIniWIB().slice(0, 8) + "01";

const KANAL: Kanal[] = ["POS", "Online", "Klinik"];

export default async function TransaksiCabangPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string; kanal?: string; cabang_id?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || awalBulan();
  const sampai = sp.sampai || hariIniWIB();
  const kanal = (sp.kanal || "") as Kanal | "";
  if (kanal && !KANAL.includes(kanal)) throw new Error("Pintu transaksi tidak valid. Pilih POS, Online, Klinik, atau semua.");
  const cabangId = sp.cabang_id || "";

  const { trx: semua, cabangList, terpotong } = await tarikTransaksi(dari, sampai);
  const cabangOptions = new Map(cabangList.map(b => [b.id, b.name]));
  for (const t of semua) if (t.cabangId) cabangOptions.set(t.cabangId,t.cabang);
  const unavailable = !!cabangId && !cabangOptions.has(cabangId);
  const trx: Trx[] = semua.filter(t => (!kanal || t.kanal===kanal) && (!cabangId || t.cabangId===cabangId));
  const hari = perHari(trx);

  const baris = perCabang(trx);
  const total = rekap(trx);
  const perCabangKanal = new Map<string, Record<Kanal, number>>();
  for (const b of baris) {
    perCabangKanal.set(b.cabangId ?? b.cabang, perKanal(trx.filter((t) => b.cabangId ? t.cabangId === b.cabangId : !t.cabangId && t.cabang === b.cabang)));
  }

  return (
    <LaporanPage
      icon="ti-building-store" title="TRANSAKSI PER CABANG"
      desc="Berapa transaksi tiap cabang, berapa orang yang dilayani, dan seberapa besar sekali belanja."
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
          <div style={{ minWidth: 170 }}>
            <label className="flab" htmlFor="report-branch">Cabang</label>
            <select id="report-branch" className="fi" name="cabang_id" defaultValue={cabangId}>
              <option value="">Semua cabang</option>
              {unavailable && <option value={cabangId}>Cabang tidak tersedia</option>}
              {[...cabangOptions].map(([id,name]) => <option key={id} value={id}>{name} · {id.slice(0,8)}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 170 }}>
            <label className="flab">Pintu transaksi</label>
            <select className="fi" name="kanal" defaultValue={kanal}>
              <option value="">Semua</option>
              {KANAL.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Cabang bertransaksi", nilai: `${baris.length} cabang` },
          { label: "Total transaksi", nilai: `${total.trx}x` },
          { label: "Pelanggan dilayani", nilai: `${total.pelangganDilayani} orang` },
          { label: "Rata-rata kunjungan/pelanggan", nilai: `${angka(total.rataTrxPerPelanggan)}x` },
          { label: "Rata-rata item/struk", nilai: angka(total.rataItemPerTrx) },
          { label: "Omzet", nilai: rp(total.omzet), warna: "#15803d" },
          { label: "Rata-rata per struk", nilai: rp(total.rataPerTrx) },
        ]} />
      }
    >
      <div className="crm-sec" style={{ marginBottom: 0 }}>
        {unavailable && <p role="alert">Cabang yang dipilih tidak tersedia pada cakupan akses/data ini. Pilih cabang yang tersedia; laporan tidak diperluas otomatis.</p>}
        {terpotong && (
          <div style={{ fontSize: 11, color: "#b45309", marginBottom: 8 }}>
            <i className="ti ti-alert-triangle" /> Rentang tanggalnya terlalu lebar — sebagian
            transaksi belum ikut terhitung. Persempit tanggalnya supaya angkanya utuh.
          </div>
        )}
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" aria-label="Transaksi per cabang" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Cabang</th>
                <th style={{ width: 90, textAlign: "center" }}>Transaksi</th>
                <th style={{ width: 150, textAlign: "center" }}>POS / Online / Klinik</th>
                <th style={{ width: 100, textAlign: "center" }}>Pelanggan dilayani</th>
                <th style={{ width: 100, textAlign: "center" }}>Pelanggan berkartu</th>
                <th style={{ width: 110, textAlign: "center" }}>Rata-rata kunjungan</th>
                <th style={{ width: 100, textAlign: "center" }}>Rata-rata item</th>
                <th style={{ width: 140, textAlign: "right" }}>Omzet</th>
                <th style={{ width: 120, textAlign: "right" }}>Rata-rata/struk</th>
              </tr>
            </thead>
            <tbody>
              {baris.map((b, i) => {
                const k = perCabangKanal.get(b.cabangId ?? b.cabang) ?? { POS: 0, Online: 0, Klinik: 0 };
                return (
                  <tr key={b.cabangId ?? b.cabang}>
                    <td style={{ fontSize: 11, fontWeight: i < 3 ? 800 : 400, color: i < 3 ? "#b45309" : "var(--tm)" }}>{i + 1}</td>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>{b.cabangId ? <Link href={`?${new URLSearchParams({dari,sampai,cabang_id:b.cabangId,...(kanal?{kanal}:{})})}`}>{b.cabang} · {b.cabangId.slice(0,8)}</Link> : b.cabang}</td>
                    <td style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700 }}>{b.trx}x</td>
                    <td style={{ textAlign: "center", fontSize: 10.5, color: "var(--tm)" }}>
                      {k.POS} / {k.Online} / {k.Klinik}
                    </td>
                    <td style={{ textAlign: "center", fontSize: 11 }}>{b.pelangganDilayani}</td>
                    <td style={{ textAlign: "center", fontSize: 11, color: "var(--tm)" }}>
                      {b.pelangganTerdaftar}
                      {b.trxTanpaAkun > 0 && (
                        <span style={{ fontSize: 9.5, color: "var(--td)" }}> +{b.trxTanpaAkun} umum</span>
                      )}
                    </td>
                    <td style={{ textAlign: "center", fontSize: 11 }}>
                      {b.pelangganTerdaftar ? `${angka(b.rataTrxPerPelanggan)}x` : "—"}
                    </td>
                    <td style={{ textAlign: "center", fontSize: 11 }}>{angka(b.rataItemPerTrx)}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(b.omzet)}</td>
                    <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{rp(b.rataPerTrx)}</td>
                  </tr>
                );
              })}
              {baris.length === 0 && <TabelKosong kolom={10} pesan="Belum ada transaksi di rentang tanggal ini." />}
            </tbody>
            {baris.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 800, background: "var(--bg2, #f8fafc)" }}>
                  <td /><td style={{ fontSize: 11.5 }}>TOTAL</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{total.trx}x</td>
                  <td />
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{total.pelangganDilayani}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{total.pelangganTerdaftar}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{angka(total.rataTrxPerPelanggan)}x</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{angka(total.rataItemPerTrx)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(total.omzet)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(total.rataPerTrx)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <h2 style={{fontSize:14,marginTop:20}}>Omzet per hari</h2>
        <p style={{fontSize:11,color:"var(--tm)"}}>Klik tanggal untuk membuka struk dan invoice pada hari WIB serta cabang/pintu transaksi yang dipilih.</p>
        <div style={{overflowX:"auto"}}>
          <table className="tbl" aria-label="Omzet per hari" style={{minWidth:540}}>
            <thead><tr><th>Tanggal WIB</th><th>Transaksi</th><th>POS / Online / Klinik</th><th style={{textAlign:"right"}}>Omzet</th></tr></thead>
            <tbody>{hari.map(h => {const k=perKanal(trx.filter(t=>t.tanggal===h.tanggal));return <tr key={h.tanggal}>
              <td><Link href={`/laporan/penjualan-rinci?${new URLSearchParams({dari:h.tanggal,sampai:h.tanggal,...(cabangId?{cabang_id:cabangId}:{}),...(kanal?{kanal}:{})})}`}>{h.tanggal}</Link></td>
              <td>{h.trx}x</td><td>{k.POS} / {k.Online} / {k.Klinik}</td><td style={{textAlign:"right"}}>{rp(h.omzet)}</td>
            </tr>})}{!hari.length&&<TabelKosong kolom={4} pesan="Belum ada transaksi pada filter ini."/>}</tbody>
            {!!hari.length&&<tfoot><tr><th>TOTAL</th><th>{total.trx}x</th><th/><th style={{textAlign:"right"}}>{rp(total.omzet)}</th></tr></tfoot>}
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          Transaksi menggabungkan tiga pintu: kasir petshop (POS), pesanan online, dan tagihan klinik.
          Omzet sudah dikurangi retur penjualan, dan tagihan klinik yang dibatalkan tidak ikut dihitung.<br />
          Nilai memakai total dokumen setelah diskon, termasuk pajak/biaya yang sudah ada pada dokumen; bukan laporan nilai sebelum pajak atau arus kas.<br />
          Dasar tanggal adalah tanggal dokumen penjualan menurut WIB. Retur mengikuti struk asal, termasuk retur yang dicatat setelah hari penjualan; laporan ini bukan arus kas/refund per hari.<br />
          &quot;Pelanggan dilayani&quot; = pelanggan berkartu yang berbeda, ditambah tiap struk pembeli umum
          yang identitasnya tidak dicatat. &quot;Rata-rata kunjungan&quot; hanya dihitung dari pelanggan
          berkartu — struk umum tidak bisa dilacak orangnya, kalau ikut dihitung angkanya selalu 1x
          dan jadi tidak berarti. Satu orang yang belanja di dua cabang dihitung di kedua cabang.
        </div>
      </div>
    </LaporanPage>
  );
}
