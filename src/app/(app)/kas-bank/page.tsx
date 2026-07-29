import { createClient } from "@/lib/supabase/server";
import { TileGrid } from "@/components/ModuleHome";
import { getAccountBalances } from "@/lib/ledger";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function KasBankPage() {
  const supabase = await createClient();

  // Satu query agregat untuk semua akun, lalu disaring ke kode milik rekening —
  // jangan query saldo per rekening (N+1).
  const [{ data: rekData }, saldoAkun] = await Promise.all([
    supabase.from("cash_accounts").select("id, nama, jenis, coa_code").eq("is_active", true).order("jenis").order("nama"),
    getAccountBalances(supabase),
  ]);

  const saldoPerKode = new Map(saldoAkun.map((a) => [a.code, a.saldo]));
  const rekening = (rekData ?? []) as { id: string; nama: string; jenis: string; coa_code: string }[];
  const total = rekening.reduce((a, r) => a + (saldoPerKode.get(r.coa_code) ?? 0), 0);

  return (
    <>
      <div className="pg-hd">Kas &amp; Bank</div>
      <div className="pg-sub">Saldo tiap rekening hari ini</div>

      {rekening.length > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          {rekening.map((r) => {
            const saldo = saldoPerKode.get(r.coa_code) ?? 0;
            return (
              <div key={r.id} className="crm-sec" style={{ margin: 0, minWidth: 190, flex: "0 1 auto" }}>
                <div style={{ fontSize: 10, color: "var(--td)", textTransform: "uppercase", letterSpacing: ".04em" }}>
                  {r.jenis} · {r.coa_code}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{r.nama}</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: saldo < 0 ? "#b91c1c" : "var(--acc)", marginTop: 4 }}>
                  {rp(saldo)}
                </div>
              </div>
            );
          })}
          <div className="crm-sec" style={{ margin: 0, minWidth: 190, flex: "0 1 auto", background: "#16213e" }}>
            <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".04em" }}>Total</div>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2, color: "#e2e8f0" }}>Semua rekening</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#fff", marginTop: 4 }}>{rp(total)}</div>
          </div>
        </div>
      )}

      <TileGrid moduleId="kas-bank" />
    </>
  );
}
