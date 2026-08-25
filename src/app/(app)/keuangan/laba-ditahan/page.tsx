import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { getAccountBalances, getAccountLedger, getAccountOpening } from "@/lib/ledger";
import { AKUN_LABA_DITAHAN, buildClosingLines } from "@/lib/tutup-buku";
import { hariIniWIB } from "@/lib/tanggal";
import { tanggalIndo } from "@/lib/followup";

// Laba Ditahan — permintaan Kamo Group 24 Agu 2026.
//
// Isinya dua angka yang sering tertukar: laba yang SUDAH ditutup ke ekuitas
// (saldo akun 3201) dan laba periode berjalan yang BELUM ditutup. Keduanya
// dipisah di sini supaya tidak ada yang mengira labanya dobel.

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
// Minus ditaruh di depan "Rp", bukan di depan angkanya — "Rp -3.585.850" susah dibaca
// dan gampang terbaca sebagai nomor, bukan sebagai rugi.
const rpTanda = (n: number) => (n < 0 ? `− ${rp(-n)}` : rp(n));

const awalTahun = () => `${hariIniWIB().slice(0, 4)}-01-01`;

export default async function LabaDitahanPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || awalTahun();
  const sampai = sp.sampai || hariIniWIB();

  const supabase = await createClient();
  const [saldoAwal, mutasi, balances, { data: lock }] = await Promise.all([
    getAccountOpening(supabase as never, AKUN_LABA_DITAHAN, { from: dari }),
    getAccountLedger(supabase as never, AKUN_LABA_DITAHAN, { from: dari, to: sampai }),
    getAccountBalances(supabase as never, { to: sampai }),
    supabase.from("accounting_locks").select("closed_until, updated_at").eq("id", true).maybeSingle(),
  ]);

  // Laba ditahan bersaldo normal kredit: kredit menambah, debit (rugi) mengurangi.
  const baris = mutasi.reduce<((typeof mutasi)[number] & { saldo: number })[]>((acc, m) => {
    const saldo = (acc[acc.length - 1]?.saldo ?? saldoAwal) + m.credit - m.debit;
    acc.push({ ...m, saldo });
    return acc;
  }, []);
  const saldoAkhir = baris[baris.length - 1]?.saldo ?? saldoAwal;

  // Laba periode yang BELUM ditutup — dihitung dari akun pendapatan & beban yang
  // masih bersaldo. Setelah tutup buku, akun-akun itu nol dan angka ini ikut nol.
  const { laba: labaBelumDitutup } = buildClosingLines(balances);
  const pendapatan = balances.filter((b) => b.type === "PENDAPATAN").reduce((a, b) => a + b.saldo, 0);
  const beban = balances.filter((b) => b.type === "BEBAN").reduce((a, b) => a + b.saldo, 0);

  const closedUntil = (lock?.closed_until as string | null) ?? null;
  const adaPenutupan = mutasi.some((m) => m.source === "closing");

  return (
    <LaporanPage
      icon="ti-pig-money" title="LABA DITAHAN"
      desc="Laba yang sudah menjadi modal perusahaan, dan laba periode berjalan yang belum ditutup."
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
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: `Saldo awal ${tanggalIndo(dari)}`, nilai: rpTanda(saldoAwal) },
          { label: "Laba ditahan (akun 3201)", nilai: rpTanda(saldoAkhir), warna: saldoAkhir >= 0 ? "#15803d" : "#b91c1c" },
          {
            label: labaBelumDitutup >= 0 ? "Laba berjalan belum ditutup" : "Rugi berjalan belum ditutup",
            nilai: rpTanda(labaBelumDitutup), warna: labaBelumDitutup >= 0 ? "#15803d" : "#b91c1c",
          },
          {
            label: "Posisi laba ditahan setelah tutup buku",
            nilai: rpTanda(saldoAkhir + labaBelumDitutup),
            warna: saldoAkhir + labaBelumDitutup >= 0 ? "#15803d" : "#b91c1c",
          },
          { label: "Periode terkunci s/d", nilai: closedUntil ? tanggalIndo(closedUntil) : "belum pernah" },
        ]} />
      }
    >
      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{
          display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
          fontSize: 11, color: adaPenutupan ? "#15803d" : "#b45309",
        }}>
          <i className={`ti ${adaPenutupan ? "ti-circle-check" : "ti-alert-triangle"}`} style={{ fontSize: 16 }} />
          <div>
            {adaPenutupan
              ? "Sudah ada jurnal penutup di rentang ini — laba periode sebelumnya sudah dipindahkan ke modal."
              : <>Belum pernah ada jurnal penutup. Selama belum ditutup, laba masih menumpuk di akun pendapatan
                dan beban, bukan di modal — dan itu wajar selama tahun buku belum berakhir.{" "}
                <Link href="/keuangan/tutup-buku" style={{ color: "#2563eb", textDecoration: "none", fontWeight: 700 }}>
                  Buka layar Tutup Buku
                </Link></>}
          </div>
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>01 · LABA PERIODE BERJALAN (BELUM DITUTUP)</div>
        <table className="tbl" style={{ minWidth: 460 }}>
          <tbody>
            <tr>
              <td style={{ fontSize: 11.5 }}>Total pendapatan</td>
              <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: "#15803d" }}>{rp(pendapatan)}</td>
            </tr>
            <tr>
              <td style={{ fontSize: 11.5 }}>Total beban</td>
              <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: "#b91c1c" }}>− {rp(beban)}</td>
            </tr>
            <tr style={{ fontWeight: 800 }}>
              <td style={{ fontSize: 12 }}>{labaBelumDitutup >= 0 ? "Laba" : "Rugi"} yang akan dipindah ke Laba Ditahan</td>
              <td style={{ textAlign: "right", fontSize: 13, color: labaBelumDitutup >= 0 ? "#15803d" : "#b91c1c" }}>
                {rp(Math.abs(labaBelumDitutup))}
              </td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          Angka ini dihitung sampai tanggal akhir yang dipilih, dari seluruh akun pendapatan dan
          beban yang masih bersaldo. Begitu tutup buku dijalankan, akun-akun itu dinolkan dan
          selisihnya pindah ke akun 3201 — angka di kotak ini otomatis jadi nol.
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>02 · MUTASI AKUN LABA DITAHAN (3201)</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ width: 95 }}>Tanggal</th>
                <th style={{ width: 150 }}>No. jurnal</th>
                <th>Keterangan</th>
                <th style={{ width: 130, textAlign: "right" }}>Berkurang</th>
                <th style={{ width: 130, textAlign: "right" }}>Bertambah</th>
                <th style={{ width: 140, textAlign: "right" }}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: "var(--sf1)" }}>
                <td colSpan={5} style={{ fontSize: 10.5, color: "var(--tm)" }}>Saldo awal {tanggalIndo(dari)}</td>
                <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>{rpTanda(saldoAwal)}</td>
              </tr>
              {baris.map((m, i) => (
                <tr key={`${m.no_jurnal}-${i}`}>
                  <td style={{ fontSize: 10.5 }}>{m.tanggal ? tanggalIndo(m.tanggal) : "—"}</td>
                  <td style={{ fontSize: 10.5, fontWeight: 600 }}>{m.no_jurnal || "—"}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                    {m.deskripsi || (m.source === "closing" ? "Jurnal penutup" : m.source)}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 10.5, color: m.debit ? "#b91c1c" : "var(--td)" }}>
                    {m.debit ? `− ${rp(m.debit)}` : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 10.5, color: m.credit ? "#15803d" : "var(--td)" }}>
                    {m.credit ? rp(m.credit) : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>{rpTanda(m.saldo)}</td>
                </tr>
              ))}
              {baris.length === 0 && (
                <TabelKosong kolom={6} pesan="Akun laba ditahan tidak bergerak di rentang tanggal ini." />
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          Akun ini normalnya hanya bergerak sekali setahun saat tutup buku, atau saat ada koreksi
          periode lampau. Kalau ada mutasi lain yang tidak dikenali, itu jurnal manual yang
          menyentuh modal — pantas ditelusuri.
        </div>
      </div>
    </LaporanPage>
  );
}
