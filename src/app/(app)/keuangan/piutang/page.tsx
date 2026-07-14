import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { AGING_BUCKETS, AGING_LABEL, agingBucket, agingDays, type AgingBucket } from "@/lib/aging";
import { terimaPelunasan } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDate = (s: string) => (s ? new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—");

type Row = {
  id: string; invoice_no: string | null; tanggal: string; customer: string;
  total: number; dibayar: number; sisa: number; days: number; bucket: AgingBucket;
};

export default async function PiutangPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const { success, error } = await searchParams;
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  // Invoice aktif yang belum lunas + pembayaran yang sudah masuk.
  const { data: invs } = await supabase
    .from("invoices")
    .select("id, invoice_no, total, dp_amount, paid_status, created_at, visits(customers(name))")
    .is("voided_at", null)
    .neq("paid_status", "Lunas")
    .order("created_at");

  const ids = (invs ?? []).map((i) => i.id);
  const { data: pays } = ids.length
    ? await supabase.from("invoice_payments").select("invoice_id, amount").in("invoice_id", ids)
    : { data: [] as { invoice_id: string; amount: number }[] };

  const paidMap = new Map<string, number>();
  for (const p of pays ?? []) paidMap.set(p.invoice_id, (paidMap.get(p.invoice_id) ?? 0) + Number(p.amount));

  const rows: Row[] = (invs ?? [])
    .map((i) => {
      const visit = Array.isArray(i.visits) ? i.visits[0] : i.visits;
      const cust = visit && (Array.isArray(visit.customers) ? visit.customers[0] : visit.customers);
      const tanggal = String(i.created_at).slice(0, 10);
      const dibayar = Number(i.dp_amount) + (paidMap.get(i.id) ?? 0);
      const sisa = Math.max(0, Number(i.total) - dibayar);
      return {
        id: i.id, invoice_no: i.invoice_no, tanggal,
        customer: cust?.name ?? "—",
        total: Number(i.total), dibayar, sisa,
        days: agingDays(tanggal, today), bucket: agingBucket(tanggal, today),
      };
    })
    .filter((r) => r.sisa > 0);

  const totalSisa = rows.reduce((a, r) => a + r.sisa, 0);
  const perBucket = Object.fromEntries(AGING_BUCKETS.map((b) => [b, rows.filter((r) => r.bucket === b).reduce((a, r) => a + r.sisa, 0)])) as Record<AgingBucket, number>;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Piutang Usaha (AR)</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Pelunasan tersimpan & sudah dijurnal.
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-triangle" /> {error}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader num="01" title="UMUR PIUTANG (AR AGING)" desc="Piutang dikelompokkan menurut umur faktur." />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
          {AGING_BUCKETS.map((b) => (
            <div key={b} className="card" style={{ textAlign: "center", background: b === "d90plus" && perBucket[b] > 0 ? "#fef2f2" : "var(--sf1)" }}>
              <div style={{ fontSize: 10, color: "var(--tm)", fontWeight: 600 }}>{AGING_LABEL[b]}</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{rp(perBucket[b])}</div>
            </div>
          ))}
          <div className="card" style={{ textAlign: "center", background: "#eff6ff" }}>
            <div style={{ fontSize: 10, color: "#2563eb", fontWeight: 600 }}>TOTAL PIUTANG</div>
            <div style={{ fontSize: 13, fontWeight: 800, marginTop: 2, color: "#2563eb" }}>{rp(totalSisa)}</div>
          </div>
        </div>
      </div>

      <div className="crm-sec">
        <SecHeader num="02" title="DAFTAR PIUTANG & PELUNASAN" desc="Terima pembayaran sisa tagihan — jurnal kas & piutang otomatis." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 680 }}>
            <thead>
              <tr><th>Invoice</th><th>Tanggal</th><th>Pelanggan</th><th style={{ textAlign: "right" }}>Total</th><th style={{ textAlign: "right" }}>Dibayar</th><th style={{ textAlign: "right" }}>Sisa</th><th>Umur</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontFamily: "monospace", fontSize: 10.5 }}>{r.invoice_no ?? "—"}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDate(r.tanggal)}</td>
                  <td style={{ fontSize: 12 }}>{r.customer}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.total)}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.dibayar)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>{rp(r.sisa)}</td>
                  <td><span className={`bge ${r.bucket === "current" || r.bucket === "d1_30" ? "g" : "r"}`}>{r.days} hari</span></td>
                  <td>
                    <details>
                      <summary className="btn-def" style={{ cursor: "pointer", padding: "3px 9px", fontSize: 10.5, listStyle: "none", display: "inline-block" }}>Terima bayar</summary>
                      <form action={terimaPelunasan} style={{ display: "flex", gap: 6, alignItems: "flex-end", marginTop: 8, flexWrap: "wrap" }}>
                        <input type="hidden" name="invoice_id" value={r.id} />
                        <div>
                          <label className="flab">Tanggal</label>
                          <input className="fi" type="date" name="tanggal" defaultValue={new Date().toISOString().slice(0, 10)} style={{ width: 130 }} />
                        </div>
                        <div>
                          <label className="flab">Nominal (maks {rp(r.sisa)})</label>
                          <input className="fi" type="number" name="amount" min={1} max={r.sisa} step="any" defaultValue={r.sisa} style={{ width: 140 }} />
                        </div>
                        <div>
                          <label className="flab">Metode</label>
                          <select className="fi" name="metode" defaultValue="Tunai" style={{ width: 110 }}>
                            <option>Tunai</option><option>QRIS</option><option>Transfer</option><option>Debit</option>
                          </select>
                        </div>
                        <button type="submit" className="pay-btn" style={{ padding: "7px 12px", fontSize: 11 }}>Simpan</button>
                      </form>
                    </details>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Tidak ada piutang — semua invoice lunas. 🎉</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
