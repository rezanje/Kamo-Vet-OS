import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { AGING_BUCKETS, AGING_LABEL, agingBucket, agingDays, type AgingBucket } from "@/lib/aging";
import { bayarHutang } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDate = (s: string) => (s ? new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—");

type Row = {
  id: string; no_po: string | null; tanggal: string; supplier: string;
  total: number; dibayar: number; sisa: number; days: number; bucket: AgingBucket;
};

export default async function HutangPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const { success, error } = await searchParams;
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  // Hutang lahir saat PO Diterima (Dr Persediaan / Cr Hutang Usaha).
  const { data: pos } = await supabase
    .from("purchase_orders")
    .select("id, no_po, tanggal, total, suppliers(nama)")
    .eq("status", "Diterima")
    .order("tanggal");

  const ids = (pos ?? []).map((p) => p.id);
  const [{ data: pays }, { data: rets }] = ids.length
    ? await Promise.all([
        supabase.from("po_payments").select("po_id, amount").in("po_id", ids),
        supabase.from("purchase_returns").select("po_id, total").in("po_id", ids),
      ])
    : [{ data: [] as { po_id: string; amount: number }[] }, { data: [] as { po_id: string; total: number }[] }];

  const paidMap = new Map<string, number>();
  for (const p of pays ?? []) paidMap.set(p.po_id, (paidMap.get(p.po_id) ?? 0) + Number(p.amount));
  // retur pembelian memotong hutang (Dr Hutang / Cr Persediaan)
  const returMap = new Map<string, number>();
  for (const r of rets ?? []) returMap.set(r.po_id, (returMap.get(r.po_id) ?? 0) + Number(r.total));

  const rows: Row[] = (pos ?? [])
    .map((p) => {
      const sup = Array.isArray(p.suppliers) ? p.suppliers[0] : p.suppliers;
      const dibayar = (paidMap.get(p.id) ?? 0) + (returMap.get(p.id) ?? 0);
      const sisa = Math.max(0, Number(p.total) - dibayar);
      return {
        id: p.id, no_po: p.no_po, tanggal: p.tanggal,
        supplier: sup?.nama ?? "—",
        total: Number(p.total), dibayar, sisa,
        days: agingDays(p.tanggal, today), bucket: agingBucket(p.tanggal, today),
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
        <span style={{ fontSize: 13, fontWeight: 500 }}>Hutang Usaha (AP)</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Pembayaran hutang tersimpan & sudah dijurnal.
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-triangle" /> {error}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader num="01" title="UMUR HUTANG (AP AGING)" desc="Hutang pembelian dikelompokkan menurut umur PO." />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
          {AGING_BUCKETS.map((b) => (
            <div key={b} className="card" style={{ textAlign: "center", background: b === "d90plus" && perBucket[b] > 0 ? "#fef2f2" : "var(--sf1)" }}>
              <div style={{ fontSize: 10, color: "var(--tm)", fontWeight: 600 }}>{AGING_LABEL[b]}</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{rp(perBucket[b])}</div>
            </div>
          ))}
          <div className="card" style={{ textAlign: "center", background: "#fef2f2" }}>
            <div style={{ fontSize: 10, color: "#dc2626", fontWeight: 600 }}>TOTAL HUTANG</div>
            <div style={{ fontSize: 13, fontWeight: 800, marginTop: 2, color: "#dc2626" }}>{rp(totalSisa)}</div>
          </div>
        </div>
      </div>

      <div className="crm-sec">
        <SecHeader num="02" title="DAFTAR HUTANG & PEMBAYARAN" desc="Bayar hutang ke pemasok — jurnal hutang & kas otomatis." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 680 }}>
            <thead>
              <tr><th>No. PO</th><th>Tanggal</th><th>Pemasok</th><th style={{ textAlign: "right" }}>Total</th><th style={{ textAlign: "right" }}>Dibayar</th><th style={{ textAlign: "right" }}>Sisa</th><th>Umur</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontFamily: "monospace", fontSize: 10.5 }}>{r.no_po ?? "—"}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDate(r.tanggal)}</td>
                  <td style={{ fontSize: 12 }}>{r.supplier}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.total)}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.dibayar)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>{rp(r.sisa)}</td>
                  <td><span className={`bge ${r.bucket === "current" || r.bucket === "d1_30" ? "g" : "r"}`}>{r.days} hari</span></td>
                  <td>
                    <details>
                      <summary className="btn-def" style={{ cursor: "pointer", padding: "3px 9px", fontSize: 10.5, listStyle: "none", display: "inline-block" }}>Bayar</summary>
                      <form action={bayarHutang} style={{ display: "flex", gap: 6, alignItems: "flex-end", marginTop: 8, flexWrap: "wrap" }}>
                        <input type="hidden" name="po_id" value={r.id} />
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
                          <select className="fi" name="metode" defaultValue="Transfer" style={{ width: 110 }}>
                            <option>Transfer</option><option>Tunai</option>
                          </select>
                        </div>
                        <button type="submit" className="pay-btn" style={{ padding: "7px 12px", fontSize: 11 }}>Simpan</button>
                      </form>
                    </details>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Tidak ada hutang berjalan. 🎉</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
