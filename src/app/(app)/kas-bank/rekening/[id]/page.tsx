import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { PrintButton } from "@/components/PrintButton";
import { getAccountLedger } from "@/lib/ledger";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDate = (s: string) => (s ? new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—");

// Sumber jurnal → bahasa orang. Kalau ada source baru, tampilkan apa adanya.
const ASAL: Record<string, string> = {
  sale: "Penjualan kasir",
  "sale-online": "Penjualan online",
  "sale-online-cair": "Pencairan marketplace",
  klinik: "Tagihan klinik",
  "klinik-ar": "Pelunasan piutang klinik",
  "klinik-edit": "Koreksi tagihan klinik",
  "klinik-void": "Pembatalan tagihan klinik",
  expense: "Beban / pengeluaran",
  "kas-entry": "Kas masuk / keluar",
  "kas-entry-void": "Pembatalan kas",
  transfer: "Transfer antar rekening",
  "transfer-void": "Pembatalan transfer",
  "purchase-pay": "Pembayaran pemasok",
  "sales-return": "Retur penjualan",
  "bank-rec": "Penyesuaian rekonsiliasi",
  asset: "Pembelian aset",
  payroll: "Penggajian",
  manual: "Jurnal manual",
};

export default async function MutasiRekeningPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dari?: string; sampai?: string }>;
}) {
  const { id } = await params;
  const { dari, sampai } = await searchParams;
  const supabase = await createClient();

  const { data: rek } = await supabase
    .from("cash_accounts").select("id, nama, jenis, coa_code, bank_nama, no_rekening").eq("id", id).maybeSingle();
  if (!rek) notFound();

  // Saldo awal = seluruh mutasi SEBELUM tanggal "dari". Tanpa ini kolom saldo berjalan
  // mulai dari nol dan tidak nyambung dengan kartu saldo di halaman modul.
  const sebelum = dari
    ? await getAccountLedger(supabase as never, rek.coa_code, { to: mundurSehari(dari) })
    : [];
  const saldoAwal = sebelum.reduce((a, l) => a + l.debit - l.credit, 0);

  const mutasi = await getAccountLedger(supabase as never, rek.coa_code, {
    from: dari || undefined, to: sampai || undefined,
  });

  const baris = mutasi.reduce<((typeof mutasi)[number] & { saldo: number })[]>((acc, l) => {
    const prev = acc.length ? acc[acc.length - 1].saldo : saldoAwal;
    acc.push({ ...l, saldo: prev + l.debit - l.credit });
    return acc;
  }, []);

  const totalMasuk = mutasi.reduce((a, l) => a + l.debit, 0);
  const totalKeluar = mutasi.reduce((a, l) => a + l.credit, 0);
  const saldoAkhir = baris.length ? baris[baris.length - 1].saldo : saldoAwal;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }} className="no-print">
        <Link href="/kas-bank/rekening" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Buku Mutasi Rekening</span>
        <span style={{ marginLeft: "auto" }}><PrintButton /></span>
      </div>

      <div className="crm-sec">
        <SecHeader
          num="01" title={`MUTASI — ${rek.nama.toUpperCase()}`}
          desc={`${rek.jenis}${rek.bank_nama ? ` · ${rek.bank_nama}` : ""}${rek.no_rekening ? ` · ${rek.no_rekening}` : ""} · akun ${rek.coa_code}`}
        />

        <form method="get" className="no-print" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
          <div>
            <label className="flab">Dari tanggal</label>
            <input className="fi" type="date" name="dari" defaultValue={dari ?? ""} style={{ width: 140 }} />
          </div>
          <div>
            <label className="flab">Sampai tanggal</label>
            <input className="fi" type="date" name="sampai" defaultValue={sampai ?? ""} style={{ width: 140 }} />
          </div>
          <button type="submit" className="btn-acc" style={{ background: "#2563eb" }}>
            <i className="ti ti-filter" /> Terapkan
          </button>
          {(dari || sampai) && (
            <Link href={`/kas-bank/rekening/${id}`} className="btn-def">Reset</Link>
          )}
        </form>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <Kartu label="Saldo awal" nilai={rp(saldoAwal)} />
          <Kartu label="Uang masuk" nilai={rp(totalMasuk)} warna="#15803d" />
          <Kartu label="Uang keluar" nilai={rp(totalKeluar)} warna="#b91c1c" />
          <Kartu label="Saldo akhir" nilai={rp(saldoAkhir)} tebal />
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ width: 100 }}>Tanggal</th>
                <th style={{ width: 130 }}>No. jurnal</th>
                <th>Keterangan</th>
                <th style={{ width: 150 }}>Asal transaksi</th>
                <th style={{ width: 110, textAlign: "right" }}>Masuk</th>
                <th style={{ width: 110, textAlign: "right" }}>Keluar</th>
                <th style={{ width: 120, textAlign: "right" }}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {baris.map((l, i) => (
                <tr key={`${l.no_jurnal}-${i}`}>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDate(l.tanggal)}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 10.5, color: "var(--tm)" }}>{l.no_jurnal || "—"}</td>
                  <td style={{ fontSize: 11 }}>{l.deskripsi || "—"}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{ASAL[l.source] ?? l.source}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: l.debit ? "#15803d" : "var(--td)" }}>{l.debit ? rp(l.debit) : "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: l.credit ? "#b91c1c" : "var(--td)" }}>{l.credit ? rp(l.credit) : "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>{rp(l.saldo)}</td>
                </tr>
              ))}
              {baris.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada mutasi pada periode ini.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Kartu({ label, nilai, warna, tebal }: { label: string; nilai: string; warna?: string; tebal?: boolean }) {
  return (
    <div className="crm-sec" style={{ margin: 0, minWidth: 160, flex: "0 1 auto", padding: 12 }}>
      <div style={{ fontSize: 10, color: "var(--td)", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: tebal ? 800 : 700, color: warna ?? "var(--sb)", marginTop: 3 }}>{nilai}</div>
    </div>
  );
}

function mundurSehari(tgl: string): string {
  const d = new Date(`${tgl}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
