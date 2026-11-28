import Link from "next/link";
import { labelSelisihSetor, type BarisHari, type RingkasanRiwayat } from "@/lib/setoran-riwayat";
import { rp, tanggalPendek, warnaBadge, type BarisDaftar } from "@/lib/setoran";

const kanan: React.CSSProperties = { textAlign: "right", whiteSpace: "nowrap" };
const warnaSelisih = (n: number): string => (n > 0 ? "#166534" : n < 0 ? "#991b1b" : "inherit");

function Kartu({ judul, nilai, catatan, warna, tid }: { judul: string; nilai: string; catatan?: string; warna?: string; tid?: string }) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontSize: 12, color: "var(--tm)" }}>{judul}</div>
      <div data-testid={tid} style={{ fontSize: 20, fontWeight: 700, color: warna ?? "inherit" }}>{nilai}</div>
      {catatan && <div style={{ fontSize: 11.5, color: "var(--tm)", marginTop: 2 }}>{catatan}</div>}
    </div>
  );
}

export function RingkasanKartu({ r, namaAkun }: { r: RingkasanRiwayat; namaAkun: string }) {
  return (
    <section aria-label="Ringkasan" style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
        <Kartu tid="total-harus" judul="Total harus disetor" nilai={rp(r.totalHarusDisetor)} catatan={`Kas tutup shift ${rp(r.totalTutupShift)} dikurangi pengeluaran dari kas ${rp(r.totalPengeluaran)}`} />
        <Kartu tid="total-transfer" judul="Total sudah ditransfer" nilai={rp(r.totalDitransfer)} catatan="Transfer Kas & Bank keluar dari kas toko (transfer masuk mengurangi)" />
        <Kartu tid="kumulatif" judul={`${labelSelisihSetor(r.kumulatif)} (kumulatif)`} nilai={rp(Math.abs(r.kumulatif))} warna={warnaSelisih(r.kumulatif)} catatan="Kelebihan = yang ditransfer lebih besar dari yang harus disetor. Dihitung sejak tanggal Dari." />
      </div>
      <div className="card" style={{ padding: 12 }} aria-label="Saldo kas toko dan uraian selisih">
        <h3 style={{ fontSize: 14, marginBottom: 6 }}>Saldo kas toko di Buku Besar dan kas yang seharusnya ada</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10, marginBottom: 8 }}>
          <Kartu tid="saldo-buku" judul={`Saldo ${namaAkun} di Buku Besar (akhir)`} nilai={rp(r.saldoAkhir)} />
          <Kartu tid="kas-seharusnya" judul="Kas yang seharusnya ada" nilai={rp(r.kasSeharusnya)} catatan="Harus disetor dikurangi sudah ditransfer, sejak tanggal Dari" />
          <Kartu tid="selisih-buku" judul="Selisih (Buku Besar − seharusnya)" nilai={rp(r.selisihBuku)} warna={warnaSelisih(r.selisihBuku)} />
        </div>
        <p style={{ fontSize: 12, color: "var(--tm)", margin: "4px 0 6px" }}>
          Pembayaran pembelian dari kas toko dan jurnal manual (mis. &quot;salah closing&quot;) ikut menggerakkan Buku Besar tetapi bukan bagian setoran. Rincian di bawah ini menjelaskan selisih di atas; jumlahnya sama dengan selisih.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" data-testid="uraian-selisih">
            <thead><tr><th>Penyebab</th><th style={kanan}>Jumlah</th><th>Keterangan</th></tr></thead>
            <tbody>
              {r.penjelasan.map((p) => <tr key={p.kode}><td>{p.label}</td><td style={kanan}>{rp(p.jumlah)}</td><td style={{ fontSize: 11.5, color: "var(--tm)" }}>{p.keterangan}</td></tr>)}
              <tr style={{ fontWeight: 700 }}><td>Selisih Buku Besar − seharusnya</td><td style={kanan}>{rp(r.selisihBuku)}</td><td /></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function TabelHarian({ hari }: { hari: BarisHari[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="tbl" data-testid="tabel-harian">
        <thead><tr>
          <th>Tanggal</th><th style={kanan}>Kas fisik tutup shift</th><th style={kanan}>Pengeluaran dari kas</th><th style={kanan}>Harus disetor</th>
          <th style={kanan}>Sudah ditransfer</th><th style={kanan}>Selisih setor harian</th><th style={kanan}>Kelebihan / kekurangan setor (kumulatif)</th><th style={kanan}>Saldo Buku Besar kas toko (akhir hari)</th>
        </tr></thead>
        <tbody>
          {hari.map((h) => (
            <tr key={h.tanggal}>
              <td>{tanggalPendek(h.tanggal)}</td>
              <td style={kanan}>{rp(h.tutupShift)}</td>
              <td style={kanan}>{rp(h.pengeluaran)}</td>
              <td style={kanan}>{rp(h.harusDisetor)}</td>
              <td style={kanan}>{rp(h.sudahDitransfer)}</td>
              <td style={{ ...kanan, color: warnaSelisih(h.selisihHarian) }}>{rp(h.selisihHarian)}</td>
              <td style={{ ...kanan, color: warnaSelisih(h.kumulatif), fontWeight: 600 }}>{rp(h.kumulatif)}</td>
              <td style={kanan}>{rp(h.saldoBukuAkhir)}</td>
            </tr>
          ))}
          {hari.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--tm)" }}>Belum ada shift ditutup atau mutasi kas toko pada rentang ini.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function TabelPeriode({ baris, basis }: { baris: BarisDaftar[]; basis: string }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="tbl" data-testid="tabel-periode">
        <thead><tr><th>No setoran</th><th>Periode</th><th>Status</th><th style={kanan}>Kewajiban</th><th style={kanan}>Pengeluaran</th><th style={kanan}>Diharapkan</th><th style={kanan}>Sudah ditransfer (tercatat di periode)</th></tr></thead>
        <tbody>
          {baris.map((b) => {
            const w = warnaBadge(b.badge);
            return (
              <tr key={b.id}>
                <td><Link href={`${basis}/${b.id}`}>{b.no_setoran}</Link></td>
                <td>{tanggalPendek(b.periode_mulai)}{b.periode_mulai !== b.periode_selesai ? ` – ${tanggalPendek(b.periode_selesai)}` : ""}</td>
                <td><span style={{ background: w.bg, color: w.fg, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>{b.badge}</span> <span style={{ fontSize: 11.5, color: "var(--tm)" }}>{b.status}</span></td>
                <td style={kanan}>{rp(b.kewajiban)}</td>
                <td style={kanan}>{rp(b.pengeluaran)}</td>
                <td style={kanan}>{rp(b.diharapkan ?? b.kewajiban - b.pengeluaran)}</td>
                <td style={kanan}>{rp(b.transfer)}</td>
              </tr>
            );
          })}
          {baris.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--tm)" }}>Belum ada periode setoran tercatat pada rentang ini.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
