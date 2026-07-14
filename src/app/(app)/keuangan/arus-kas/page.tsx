import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { getCashMovements } from "@/lib/ledger";
import { PeriodFilter } from "../PeriodFilter";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Peta source jurnal → aktivitas arus kas + label.
const SRC: Record<string, { act: "operasi" | "investasi" | "pendanaan"; label: string }> = {
  sale: { act: "operasi", label: "Penerimaan penjualan POS" },
  klinik: { act: "operasi", label: "Penerimaan jasa klinik" },
  "klinik-ar": { act: "operasi", label: "Pelunasan piutang pelanggan" },
  "klinik-edit": { act: "operasi", label: "Koreksi invoice klinik" },
  "klinik-void": { act: "operasi", label: "Void invoice klinik" },
  expense: { act: "operasi", label: "Pembayaran beban operasional" },
  payroll: { act: "operasi", label: "Pembayaran gaji karyawan" },
  shift: { act: "operasi", label: "Selisih kas kasir" },
  purchase: { act: "operasi", label: "Pembayaran pembelian" },
  "purchase-pay": { act: "operasi", label: "Pembayaran hutang pembelian" },
  "stock-in": { act: "operasi", label: "Pembelian stok" },
  "bank-rec": { act: "operasi", label: "Penyesuaian rekonsiliasi bank" },
  asset: { act: "investasi", label: "Pembelian aset tetap" },
  manual: { act: "pendanaan", label: "Setoran modal / jurnal manual" },
};

export default async function ArusKasPage({ searchParams }: { searchParams: Promise<{ dari?: string; sampai?: string; cabang?: string }> }) {
  const { dari, sampai, cabang } = await searchParams;
  const supabase = await createClient();
  const [{ moves, saldoKasNow, saldoAwal }, { data: branches }] = await Promise.all([
    getCashMovements(supabase as never, { from: dari || undefined, to: sampai || undefined, branchId: cabang || undefined }),
    supabase.from("branches").select("id, name").order("name"),
  ]);

  const rows = moves.map((m) => {
    const cfg = SRC[m.source] ?? { act: "operasi" as const, label: m.source };
    return { ...cfg, masuk: m.masuk, keluar: m.keluar, net: m.masuk - m.keluar };
  });

  const operasi = rows.filter((r) => r.act === "operasi");
  const investasi = rows.filter((r) => r.act === "investasi");
  const pendanaan = rows.filter((r) => r.act === "pendanaan");
  const sub = (arr: typeof rows) => arr.reduce((a, r) => a + r.net, 0);
  const netOperasi = sub(operasi), netInvestasi = sub(investasi), netPendanaan = sub(pendanaan);
  const kenaikan = netOperasi + netInvestasi + netPendanaan;
  // saldoAwal = posisi kas sebelum periode (dihitung dari jurnal, bukan hardcode).
  const saldoAkhir = saldoAwal + kenaikan;
  const sinkron = Math.round(saldoAkhir) === Math.round(saldoKasNow);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Laporan Arus Kas</span>
      </div>

      <div className="p2ban" style={{ background: sinkron ? "#e8f5ee" : "#fef2f2", border: `.5px solid ${sinkron ? "#86efac" : "#fca5a5"}`, color: sinkron ? "#15803d" : "#b91c1c" }}>
        <i className={`ti ti-${sinkron ? "circle-check" : "alert-triangle"}`} />{" "}
        {sinkron
          ? `Sinkron — saldo kas akhir = saldo Kas+Bank di buku besar (${rp(saldoKasNow)})`
          : `TIDAK sinkron — arus kas ${rp(saldoAkhir)} ≠ buku besar ${rp(saldoKasNow)}`}
      </div>

      <div className="crm-sec">
        <SecHeader num="01" title="ARUS KAS (METODE LANGSUNG)" desc="Pergerakan kas dari seluruh transaksi, dikelompokkan per aktivitas." />
        <PeriodFilter basePath="/keuangan/arus-kas" dari={dari} sampai={sampai} cabang={cabang} branches={branches ?? []} />

        <Activity title="AKTIVITAS OPERASI" rows={operasi} subtotal={netOperasi} />
        <div style={{ height: 14 }} />
        <Activity title="AKTIVITAS INVESTASI" rows={investasi} subtotal={netInvestasi} />
        <div style={{ height: 14 }} />
        <Activity title="AKTIVITAS PENDANAAN" rows={pendanaan} subtotal={netPendanaan} />

        <div style={{ marginTop: 16, borderTop: "2px solid #16213e", paddingTop: 10 }}>
          <BigRow label="Kenaikan (Penurunan) Kas Bersih" value={kenaikan} />
          <BigRow label="Saldo Kas Awal" value={saldoAwal} muted />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 800 }}>SALDO KAS AKHIR</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: "var(--acc)" }}>{rp(saldoAkhir)}</span>
          </div>
        </div>
      </div>
    </>
  );
}

function Activity({ title, rows, subtotal }: { title: string; rows: { label: string; masuk: number; keluar: number; net: number }[]; subtotal: number }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tm)", letterSpacing: ".06em", marginBottom: 6 }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--td)", padding: "2px 0" }}>Tidak ada pergerakan kas.</div>
      ) : (
        rows.map((r) => (
          <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12, borderBottom: ".5px solid var(--bd)" }}>
            <span>{r.label}
              <span style={{ fontSize: 9.5, color: "var(--td)", marginLeft: 6 }}>
                (masuk {rp(r.masuk)} · keluar {rp(r.keluar)})
              </span>
            </span>
            <span style={{ fontWeight: 500, color: r.net >= 0 ? "#15803d" : "#b91c1c" }}>{r.net >= 0 ? "" : "-"}{rp(Math.abs(r.net))}</span>
          </div>
        ))
      )}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12, fontWeight: 600 }}>
        <span>Kas Bersih dari {title.replace("AKTIVITAS ", "").toLowerCase()}</span>
        <span>{subtotal < 0 ? "-" : ""}{rp(Math.abs(subtotal))}</span>
      </div>
    </div>
  );
}
function BigRow({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, fontWeight: 600, color: muted ? "var(--tm)" : "#141413" }}>
      <span>{label}</span><span>{value < 0 ? "-" : ""}{rp(Math.abs(value))}</span>
    </div>
  );
}
