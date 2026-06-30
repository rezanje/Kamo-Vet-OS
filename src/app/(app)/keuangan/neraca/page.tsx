import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { getAccountBalances } from "@/lib/ledger";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function NeracaPage() {
  const supabase = await createClient();
  const balances = await getAccountBalances(supabase as never);

  const aset = balances.filter((b) => b.type === "ASET" && b.saldo !== 0);
  const liabilitas = balances.filter((b) => b.type === "LIABILITAS" && b.saldo !== 0);
  const ekuitas = balances.filter((b) => b.type === "EKUITAS" && b.saldo !== 0);
  const pendapatan = balances.filter((b) => b.type === "PENDAPATAN").reduce((a, b) => a + b.saldo, 0);
  const beban = balances.filter((b) => b.type === "BEBAN").reduce((a, b) => a + b.saldo, 0);
  const labaBerjalan = pendapatan - beban; // belum di-closing ke ekuitas

  const totalAset = aset.reduce((a, b) => a + b.saldo, 0);
  const totalLiabilitas = liabilitas.reduce((a, b) => a + b.saldo, 0);
  const totalEkuitas = ekuitas.reduce((a, b) => a + b.saldo, 0) + labaBerjalan;
  const totalPasiva = totalLiabilitas + totalEkuitas;
  const seimbang = Math.round(totalAset) === Math.round(totalPasiva);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Neraca</span>
      </div>

      <div className={`p2ban`} style={{ background: seimbang ? "#e8f5ee" : "#fef2f2", border: `.5px solid ${seimbang ? "#86efac" : "#fca5a5"}`, color: seimbang ? "#15803d" : "#b91c1c" }}>
        <i className={`ti ti-${seimbang ? "circle-check" : "alert-triangle"}`} /> {seimbang ? `Neraca seimbang — Aktiva = Pasiva = ${rp(totalAset)}` : "Neraca TIDAK seimbang — ada kesalahan posting!"}
      </div>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="01" title="AKTIVA" desc="Aset perusahaan." />
          <Group rows={aset} />
          <TotalRow label="TOTAL AKTIVA" value={totalAset} />
        </div>

        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="02" title="PASIVA" desc="Liabilitas + Ekuitas." />
          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tm)", letterSpacing: ".06em", margin: "4px 0 6px" }}>LIABILITAS</div>
          <Group rows={liabilitas} />
          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tm)", letterSpacing: ".06em", margin: "10px 0 6px" }}>EKUITAS</div>
          <Group rows={ekuitas} />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, borderBottom: ".5px solid var(--bd)", fontStyle: "italic", color: "var(--tm)" }}>
            <span>Laba berjalan (belum ditutup)</span><span>{rp(labaBerjalan)}</span>
          </div>
          <TotalRow label="TOTAL PASIVA" value={totalPasiva} />
        </div>
      </div>
    </>
  );
}

function Group({ rows }: { rows: { code: string; name: string; saldo: number }[] }) {
  if (rows.length === 0) return <div style={{ fontSize: 11, color: "var(--td)", padding: "2px 0" }}>—</div>;
  return (
    <>
      {rows.map((r) => (
        <div key={r.code} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, borderBottom: ".5px solid var(--bd)" }}>
          <span><span style={{ color: "var(--td)", fontFamily: "monospace", fontSize: 10, marginRight: 6 }}>{r.code}</span>{r.name}</span>
          <span>{rp(r.saldo)}</span>
        </div>
      ))}
    </>
  );
}
function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", marginTop: 6, borderTop: "2px solid #16213e", fontSize: 13, fontWeight: 700 }}>
      <span>{label}</span><span>{rp(value)}</span>
    </div>
  );
}
