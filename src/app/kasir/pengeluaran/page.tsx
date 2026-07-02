import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { SecHeader } from "@/components/SecHeader";
import { simpanPengeluaranKasir } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtTgl = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

type ExpenseRow = {
  id: string;
  tanggal: string;
  kategori: string;
  deskripsi: string | null;
  jumlah: number;
  metode_bayar: string;
};

const KATEGORI = ["Operasional", "Listrik & Air", "Perlengkapan", "Transportasi", "Perawatan", "Lain-lain"];
const METODE = ["Tunai", "QRIS", "Transfer"];

// Pengeluaran dari dunia kasir — dibatasi ke cabang shift yang sedang terbuka (tanpa pilihan cabang).
export default async function PengeluaranKasirPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const today = "2026-07-01";
  const monthStart = "2026-07-01";

  // Ringkasan bulan berjalan untuk cabang shift ini (mencakup hari ini).
  const { data: summaryRaw } = await supabase
    .from("expenses")
    .select("tanggal, jumlah")
    .eq("branch_id", shift.branch_id)
    .gte("tanggal", monthStart);
  const summaryRows = (summaryRaw ?? []) as { tanggal: string; jumlah: number }[];
  const totHari = summaryRows.filter((r) => r.tanggal === today).reduce((a, r) => a + Number(r.jumlah), 0);
  const totBulan = summaryRows.reduce((a, r) => a + Number(r.jumlah), 0);

  // Daftar pengeluaran terbaru cabang ini.
  const { data: rowsRaw } = await supabase
    .from("expenses")
    .select("id, tanggal, kategori, deskripsi, jumlah, metode_bayar")
    .eq("branch_id", shift.branch_id)
    .order("tanggal", { ascending: false })
    .limit(20);
  const rows = (rowsRaw ?? []) as ExpenseRow[];
  const totDaftar = rows.reduce((a, r) => a + Number(r.jumlah), 0);

  return (
    <>
      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success === "1" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Pengeluaran tercatat.</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 14 }}>
        <Stat label="Pengeluaran Hari Ini" value={rp(totHari)} />
        <Stat label="Pengeluaran Bulan Ini" value={rp(totBulan)} accent />
      </div>

      <div className="crm-sec">
        <SecHeader num="01" title="CATAT PENGELUARAN" desc={`Tambahkan pengeluaran operasional · ${shift.branchName}`} />
        <form action={simpanPengeluaranKasir}>
          <input type="hidden" name="branchId" value={shift.branch_id} />
          <div className="grid2">
            <div>
              <label className="flab">Tanggal *</label>
              <input className="fi" name="tanggal" type="date" defaultValue={today} required />
            </div>
            <div>
              <label className="flab">Kategori *</label>
              <select className="fi" name="kategori" required>
                <option value="">Pilih kategori</option>
                {KATEGORI.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className="flab">Metode Bayar *</label>
              <select className="fi" name="metode_bayar" defaultValue="Tunai" required>
                {METODE.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="flab">Jumlah (Rp) *</label>
              <input className="fi" name="jumlah" type="number" min={0} step={1000} placeholder="50000" required />
            </div>
            <div>
              <label className="flab">Deskripsi</label>
              <input className="fi" name="deskripsi" type="text" placeholder="Keterangan pengeluaran (opsional)" />
            </div>
          </div>
          {/* ponytail: tanpa upload bukti — bukti_url dibiarkan null sesuai spec. */}
          <div style={{ marginTop: 12, borderTop: ".5px solid var(--bd)", paddingTop: 12 }}>
            <button type="submit" className="btn-acc"><i className="ti ti-plus" /> Simpan Pengeluaran</button>
          </div>
        </form>
      </div>

      <div className="crm-sec">
        <SecHeader num="02" title="DAFTAR PENGELUARAN" desc={`20 pengeluaran terbaru · ${shift.branchName}`} />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 600 }}>
            <thead>
              <tr><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th>Metode</th><th style={{ textAlign: "right" }}>Jumlah</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtTgl(r.tanggal)}</td>
                  <td style={{ fontSize: 11 }}><span className="bge o">{r.kategori}</span></td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.deskripsi || "—"}</td>
                  <td style={{ fontSize: 11 }}>{r.metode_bayar}</td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>{rp(Number(r.jumlah))}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada pengeluaran tercatat.</td></tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ fontSize: 11, fontWeight: 700, textAlign: "right" }}>Total</td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>{rp(totDaftar)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card" style={{ padding: "11px 13px" }}>
      <div style={{ fontSize: 9.5, color: "var(--tm)" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: accent ? "var(--acc)" : "#141413", marginTop: 3 }}>{value}</div>
    </div>
  );
}
