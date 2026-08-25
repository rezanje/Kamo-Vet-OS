// Tampilan buku besar pembantu — dipakai piutang dan hutang. Bentuknya sama persis,
// yang beda cuma arah saldo dan istilahnya, jadi tidak dibikin dua kali.
import Link from "next/link";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { totalPembantu, selisihBukuBesar, type BarisPihak } from "@/lib/buku-pembantu";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmt = (s: string) =>
  s ? new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

const WARNA_JENIS: Record<string, string> = {
  Faktur: "#b45309", Pembayaran: "#15803d", "Uang muka": "#2563eb", Retur: "#7c3aed",
};

export function BukuPembantu({
  icon, title, desc, filter, baris, labelPihak, labelNaik, labelTurun,
  kodeAkun, namaAkun, saldoBukuBesar, dari, sampai, catatan,
}: {
  icon: string;
  title: string;
  desc: string;
  filter: React.ReactNode;
  baris: BarisPihak[];
  /** "Pelanggan" atau "Pemasok". */
  labelPihak: string;
  labelNaik: string;
  labelTurun: string;
  kodeAkun: string;
  namaAkun: string;
  saldoBukuBesar: number;
  dari: string;
  sampai: string;
  catatan: React.ReactNode;
}) {
  const total = totalPembantu(baris);
  const selisih = selisihBukuBesar(total.saldoAkhir, saldoBukuBesar);

  return (
    <LaporanPage
      icon={icon} title={title} desc={desc} filter={filter}
      ringkasan={
        <KartuAngka items={[
          { label: labelPihak, nilai: `${baris.length} pihak` },
          { label: `Saldo awal ${fmt(dari)}`, nilai: rp(total.saldoAwal) },
          { label: labelNaik, nilai: rp(total.naik), warna: "#b45309" },
          { label: labelTurun, nilai: `− ${rp(total.turun)}`, warna: "#15803d" },
          { label: `Saldo akhir ${fmt(sampai)}`, nilai: rp(total.saldoAkhir), warna: "var(--sb)" },
        ]} />
      }
    >
      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{
          display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap",
          fontSize: 11, color: selisih === 0 ? "#15803d" : "#b91c1c",
        }}>
          <i className={`ti ${selisih === 0 ? "ti-circle-check" : "ti-alert-triangle"}`} style={{ fontSize: 16 }} />
          <div>
            <b>Cocok dengan buku besar?</b>{" "}
            Buku pembantu {rp(total.saldoAkhir)} · akun {kodeAkun} {namaAkun} {rp(saldoBukuBesar)}
            {selisih === 0
              ? " — sama persis."
              : ` — selisih ${rp(Math.abs(selisih))}. Berarti ada dokumen yang belum terjurnal atau jurnal manual yang tidak berasal dari faktur.`}
          </div>
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>{labelPihak}</th>
                <th style={{ width: 130, textAlign: "right" }}>Saldo awal</th>
                <th style={{ width: 130, textAlign: "right" }}>{labelNaik}</th>
                <th style={{ width: 130, textAlign: "right" }}>{labelTurun}</th>
                <th style={{ width: 140, textAlign: "right" }}>Saldo akhir</th>
                <th style={{ width: 90, textAlign: "center" }}>Rincian</th>
              </tr>
            </thead>
            <tbody>
              {baris.map((b) => (
                <tr key={b.pihakId}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{b.pihak}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{rp(b.saldoAwal)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: b.naik ? "#b45309" : "var(--td)" }}>
                    {b.naik ? rp(b.naik) : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11, color: b.turun ? "#15803d" : "var(--td)" }}>
                    {b.turun ? `− ${rp(b.turun)}` : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(b.saldoAkhir)}</td>
                  <td style={{ textAlign: "center", fontSize: 10.5, color: "var(--tm)" }}>{b.mutasi.length} baris</td>
                </tr>
              ))}
              {baris.length === 0 && (
                <TabelKosong kolom={6} pesan="Tidak ada pergerakan di rentang tanggal ini." />
              )}
            </tbody>
            {baris.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 800 }}>
                  <td style={{ fontSize: 11.5 }}>TOTAL</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(total.saldoAwal)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(total.naik)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>− {rp(total.turun)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(total.saldoAkhir)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {baris.map((b) => (
        <details key={b.pihakId} className="crm-sec" style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>{b.pihak}</span>
            <span style={{ fontWeight: 600, color: "var(--tm)" }}>
              saldo akhir {rp(b.saldoAkhir)} · {b.mutasi.length} pergerakan
            </span>
          </summary>
          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table className="tbl" style={{ minWidth: 780 }}>
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Tanggal</th>
                  <th style={{ width: 150 }}>Nomor</th>
                  <th style={{ width: 100 }}>Jenis</th>
                  <th>Keterangan</th>
                  <th style={{ width: 120, textAlign: "right" }}>{labelNaik}</th>
                  <th style={{ width: 120, textAlign: "right" }}>{labelTurun}</th>
                  <th style={{ width: 130, textAlign: "right" }}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ background: "var(--sf1)" }}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }} colSpan={6}>Saldo awal {fmt(dari)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>{rp(b.saldoAwal)}</td>
                </tr>
                {b.mutasi.map((m, i) => (
                  <tr key={`${m.nomor}-${m.jenis}-${i}`}>
                    <td style={{ fontSize: 10.5 }}>{fmt(m.tanggal)}</td>
                    <td style={{ fontSize: 10.5, fontWeight: 600 }}>
                      {m.href ? <Link href={m.href} style={{ color: "#2563eb", textDecoration: "none" }}>{m.nomor}</Link> : m.nomor}
                    </td>
                    <td style={{ fontSize: 10.5, color: WARNA_JENIS[m.jenis] ?? "var(--tm)", fontWeight: 600 }}>{m.jenis}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{m.keterangan}</td>
                    <td style={{ textAlign: "right", fontSize: 10.5 }}>{m.naik ? rp(m.naik) : "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 10.5 }}>{m.turun ? `− ${rp(m.turun)}` : "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>{rp(m.saldo)}</td>
                  </tr>
                ))}
                {b.mutasi.length === 0 && (
                  <TabelKosong kolom={7} pesan="Tidak bergerak di rentang ini — saldonya bawaan dari periode sebelumnya." />
                )}
              </tbody>
            </table>
          </div>
        </details>
      ))}

      <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 10, lineHeight: 1.6 }}>{catatan}</div>
    </LaporanPage>
  );
}
