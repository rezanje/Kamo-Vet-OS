import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { getCashLedgerPerAccount } from "@/lib/ledger";
import { labelSumber } from "@/lib/arus-kas";
import { hariIniWIB } from "@/lib/tanggal";

// Rincian Arus Kas per Rekening — permintaan Kamo Group 24 Agu 2026.
// Menjawab tiga baris di daftar mereka sekaligus: "rincian arus kas",
// "arus kas per akun", dan "rincian pembayaran per bank" — ketiganya
// pertanyaan yang sama: uang ini masuk/keluar lewat rekening yang mana.

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmt = (s: string) =>
  s ? new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

const awalBulan = () => hariIniWIB().slice(0, 8) + "01";

export default async function RincianArusKasPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string; cabang?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || awalBulan();
  const sampai = sp.sampai || hariIniWIB();
  const cabang = sp.cabang || "";

  const supabase = await createClient();
  const [rekening, { data: branches }] = await Promise.all([
    getCashLedgerPerAccount(supabase as never, { from: dari, to: sampai, branchId: cabang || undefined }),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);

  const totalAwal = rekening.reduce((a, r) => a + r.saldoAwal, 0);
  const totalMasuk = rekening.reduce((a, r) => a + r.masuk, 0);
  const totalKeluar = rekening.reduce((a, r) => a + r.keluar, 0);
  const totalAkhir = totalAwal + totalMasuk - totalKeluar;

  // Rekap per jenis transaksi — menjawab "pembayaran lewat bank ini isinya apa saja".
  const perSumber = new Map<string, { masuk: number; keluar: number }>();
  for (const r of rekening) {
    for (const m of r.mutasi) {
      const cur = perSumber.get(m.source) ?? { masuk: 0, keluar: 0 };
      cur.masuk += m.debit;
      cur.keluar += m.credit;
      perSumber.set(m.source, cur);
    }
  }
  const sumberRows = [...perSumber].map(([source, v]) => ({ source, ...v }))
    .sort((a, b) => (b.masuk + b.keluar) - (a.masuk + a.keluar));

  return (
    <LaporanPage
      icon="ti-building-bank" title="RINCIAN ARUS KAS PER REKENING"
      desc="Tiap kas dan rekening bank: saldo awal, uang masuk, uang keluar, dan saldo akhirnya."
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
            <label className="flab">Cabang</label>
            <select className="fi" name="cabang" defaultValue={cabang}>
              <option value="">Semua cabang</option>
              {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Rekening", nilai: `${rekening.length} rekening` },
          { label: `Saldo awal ${fmt(dari)}`, nilai: rp(totalAwal) },
          { label: "Uang masuk", nilai: rp(totalMasuk), warna: "#15803d" },
          { label: "Uang keluar", nilai: `− ${rp(totalKeluar)}`, warna: "#b91c1c" },
          { label: `Saldo akhir ${fmt(sampai)}`, nilai: rp(totalAkhir) },
        ]} />
      }
    >
      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ width: 70 }}>Akun</th>
                <th>Rekening</th>
                <th style={{ width: 90 }}>Jenis</th>
                <th style={{ width: 130, textAlign: "right" }}>Saldo awal</th>
                <th style={{ width: 130, textAlign: "right" }}>Masuk</th>
                <th style={{ width: 130, textAlign: "right" }}>Keluar</th>
                <th style={{ width: 140, textAlign: "right" }}>Saldo akhir</th>
              </tr>
            </thead>
            <tbody>
              {rekening.map((r) => (
                <tr key={r.code}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.code}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.nama}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.jenis}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{rp(r.saldoAwal)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: r.masuk ? "#15803d" : "var(--td)" }}>
                    {r.masuk ? rp(r.masuk) : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11, color: r.keluar ? "#b91c1c" : "var(--td)" }}>
                    {r.keluar ? `− ${rp(r.keluar)}` : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(r.saldoAkhir)}</td>
                </tr>
              ))}
              {rekening.length === 0 && <TabelKosong kolom={7} pesan="Belum ada rekening kas/bank yang aktif." />}
            </tbody>
            {rekening.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 800 }}>
                  <td /><td style={{ fontSize: 11.5 }}>TOTAL</td><td />
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(totalAwal)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(totalMasuk)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>− {rp(totalKeluar)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(totalAkhir)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>UANG INI DATANG DAN PERGI KE MANA</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>Jenis transaksi</th>
                <th style={{ width: 150, textAlign: "right" }}>Masuk</th>
                <th style={{ width: 150, textAlign: "right" }}>Keluar</th>
              </tr>
            </thead>
            <tbody>
              {sumberRows.map((s) => (
                <tr key={s.source}>
                  <td style={{ fontSize: 11 }}>{labelSumber(s.source)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: s.masuk ? "#15803d" : "var(--td)" }}>
                    {s.masuk ? rp(s.masuk) : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11, color: s.keluar ? "#b91c1c" : "var(--td)" }}>
                    {s.keluar ? `− ${rp(s.keluar)}` : "—"}
                  </td>
                </tr>
              ))}
              {sumberRows.length === 0 && <TabelKosong kolom={3} pesan="Tidak ada pergerakan kas di rentang ini." />}
            </tbody>
          </table>
        </div>
      </div>

      {rekening.map((r) => (
        <details key={r.code} className="crm-sec" style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>{r.nama} <span style={{ color: "var(--td)", fontWeight: 500 }}>({r.code})</span></span>
            <span style={{ fontWeight: 600, color: "var(--tm)" }}>
              saldo akhir {rp(r.saldoAkhir)} · {r.mutasi.length} pergerakan
            </span>
          </summary>
          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table className="tbl" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Tanggal</th>
                  <th style={{ width: 140 }}>No. jurnal</th>
                  <th style={{ width: 180 }}>Jenis transaksi</th>
                  <th>Keterangan</th>
                  <th style={{ width: 120, textAlign: "right" }}>Masuk</th>
                  <th style={{ width: 120, textAlign: "right" }}>Keluar</th>
                  <th style={{ width: 130, textAlign: "right" }}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ background: "var(--sf1)" }}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }} colSpan={6}>Saldo awal {fmt(dari)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>{rp(r.saldoAwal)}</td>
                </tr>
                {r.mutasi.map((m, i) => (
                  <tr key={`${m.no_jurnal}-${i}`}>
                    <td style={{ fontSize: 10.5 }}>{fmt(m.tanggal)}</td>
                    <td style={{ fontSize: 10.5, fontWeight: 600 }}>{m.no_jurnal || "—"}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{labelSumber(m.source)}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{m.deskripsi || "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 10.5, color: m.debit ? "#15803d" : "var(--td)" }}>
                      {m.debit ? rp(m.debit) : "—"}
                    </td>
                    <td style={{ textAlign: "right", fontSize: 10.5, color: m.credit ? "#b91c1c" : "var(--td)" }}>
                      {m.credit ? `− ${rp(m.credit)}` : "—"}
                    </td>
                    <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>{rp(m.saldo)}</td>
                  </tr>
                ))}
                {r.mutasi.length === 0 && (
                  <TabelKosong kolom={7} pesan="Rekening ini tidak bergerak di rentang tanggal ini." />
                )}
              </tbody>
            </table>
          </div>
        </details>
      ))}

      <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 10, lineHeight: 1.6 }}>
        Angkanya dibaca dari jurnal, jadi sama persis dengan Buku Besar dan laporan Arus Kas.
        Dua rekening yang menunjuk akun buku besar yang sama tidak bisa dipisah mutasinya —
        kalau itu terjadi namanya digabung dalam satu baris supaya tidak terlihat seperti dua
        rekening yang masing-masing memegang saldo penuh.<br />
        Filter cabang mengikuti cabang pada jurnalnya. Jurnal tanpa cabang (mis. jurnal pusat)
        tidak akan muncul kalau cabang dipilih.
      </div>
    </LaporanPage>
  );
}
