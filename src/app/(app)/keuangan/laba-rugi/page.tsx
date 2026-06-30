import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { getAccountBalances } from "@/lib/ledger";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function LabaRugiPage() {
  const supabase = await createClient();
  const balances = await getAccountBalances(supabase as never);

  const pendapatan = balances.filter((b) => b.type === "PENDAPATAN" && b.saldo !== 0);
  const beban = balances.filter((b) => b.type === "BEBAN" && b.saldo !== 0);

  const totalPendapatan = pendapatan.reduce((a, b) => a + b.saldo, 0);
  const hpp = beban.filter((b) => b.code === "5101").reduce((a, b) => a + b.saldo, 0);
  const bebanOperasional = beban.filter((b) => b.code !== "5101");
  const totalBebanOps = bebanOperasional.reduce((a, b) => a + b.saldo, 0);
  const labaKotor = totalPendapatan - hpp;
  const labaBersih = labaKotor - totalBebanOps;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Laporan Laba Rugi</span>
      </div>

      <div className="crm-sec">
        <SecHeader num="01" title="LABA RUGI" desc="Pendapatan dikurangi beban (seluruh periode)." />

        <Group title="PENDAPATAN" rows={pendapatan} />
        <TotalRow label="Total Pendapatan" value={totalPendapatan} />

        <div style={{ height: 14 }} />
        <Group title="HARGA POKOK PENJUALAN" rows={beban.filter((b) => b.code === "5101")} />
        <SubRow label="Laba Kotor" value={labaKotor} strong />

        <div style={{ height: 14 }} />
        <Group title="BEBAN OPERASIONAL" rows={bebanOperasional} />
        <TotalRow label="Total Beban Operasional" value={totalBebanOps} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 12, borderTop: "2px solid #16213e" }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>LABA BERSIH</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: labaBersih >= 0 ? "#15803d" : "#b91c1c" }}>{rp(labaBersih)}</span>
        </div>
      </div>
    </>
  );
}

function Group({ title, rows }: { title: string; rows: { code: string; name: string; saldo: number }[] }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tm)", letterSpacing: ".06em", margin: "4px 0 6px" }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--td)", padding: "2px 0" }}>—</div>
      ) : (
        rows.map((r) => (
          <div key={r.code} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, borderBottom: ".5px solid var(--bd)" }}>
            <span><span style={{ color: "var(--td)", fontFamily: "monospace", fontSize: 10, marginRight: 6 }}>{r.code}</span>{r.name}</span>
            <span>{rp(r.saldo)}</span>
          </div>
        ))
      )}
    </div>
  );
}
function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12, fontWeight: 600 }}>
      <span>{label}</span><span>{rp(value)}</span>
    </div>
  );
}
function SubRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", marginTop: 4, borderTop: "1px solid var(--bd)", fontSize: 13, fontWeight: strong ? 700 : 500 }}>
      <span>{label}</span><span style={{ color: "var(--acc)" }}>{rp(value)}</span>
    </div>
  );
}
