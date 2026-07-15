import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { catatBeban } from "./actions";
import { KATEGORI_BEBAN } from "./kategori";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDate = (s: string) => (s ? new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default async function BebanPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const { success, error } = await searchParams;
  const supabase = await createClient();

  const [{ data: branches }, { data: rows }] = await Promise.all([
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    supabase.from("expenses").select("id, tanggal, kategori, deskripsi, jumlah, metode_bayar, branches(name)").order("tanggal", { ascending: false }).limit(30),
  ]);

  const bulanIni = (rows ?? []).filter((r) => String(r.tanggal).slice(0, 7) === new Date().toISOString().slice(0, 7)).reduce((a, r) => a + Number(r.jumlah), 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/buku-besar" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Pencatatan Beban</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Beban tersimpan & langsung dijurnal (Dr Beban / Cr Kas/Bank).
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-triangle" /> {error}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader num="01" title="CATAT BEBAN BARU" desc="Setiap beban langsung terekam di jurnal umum (seperti Accurate)." />
        <form action={catatBeban}>
          <div className="frow" style={{ marginBottom: 10 }}>
            <div>
              <label className="flab">Tanggal</label>
              <input className="fi" type="date" name="tanggal" defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
            <div>
              <label className="flab">Cabang</label>
              <select className="fi" name="branch_id" required defaultValue="">
                <option value="" disabled>— pilih cabang —</option>
                {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
          <div className="frow" style={{ marginBottom: 10 }}>
            <div>
              <label className="flab">Kategori beban</label>
              <select className="fi" name="kategori" required defaultValue="">
                <option value="" disabled>— pilih kategori —</option>
                {Object.keys(KATEGORI_BEBAN).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className="flab">Nominal</label>
              <input className="fi" type="number" name="jumlah" min={1} step="any" required />
            </div>
          </div>
          <div className="frow" style={{ marginBottom: 12 }}>
            <div>
              <label className="flab">Sumber dana</label>
              <select className="fi" name="metode" defaultValue="Tunai">
                <option value="Tunai">Kas (tunai)</option>
                <option value="Transfer">Bank (transfer)</option>
              </select>
            </div>
            <div>
              <label className="flab">Keterangan (opsional)</label>
              <input className="fi" name="deskripsi" placeholder="mis. bayar listrik cabang Cimanggu" />
            </div>
          </div>
          <button type="submit" className="pay-btn"><i className="ti ti-plus" /> Catat & Jurnal</button>
        </form>
      </div>

      <div className="crm-sec">
        <SecHeader num="02" title="BEBAN TERBARU" desc={`Total beban bulan ini: ${rp(bulanIni)}.`} />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr><th>Tanggal</th><th>Kategori</th><th>Keterangan</th><th>Cabang</th><th>Sumber</th><th style={{ textAlign: "right" }}>Nominal</th></tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => {
                const br = Array.isArray(r.branches) ? r.branches[0] : r.branches;
                return (
                  <tr key={r.id}>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDate(r.tanggal)}</td>
                    <td style={{ fontSize: 12 }}>{r.kategori}</td>
                    <td style={{ fontSize: 11.5, color: "var(--tm)" }}>{r.deskripsi ?? "—"}</td>
                    <td style={{ fontSize: 11 }}>{br?.name ?? "—"}</td>
                    <td><span className={`bge ${r.metode_bayar === "Tunai" ? "g" : "b"}`}>{r.metode_bayar}</span></td>
                    <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>{rp(Number(r.jumlah))}</td>
                  </tr>
                );
              })}
              {(rows ?? []).length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada beban tercatat.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
