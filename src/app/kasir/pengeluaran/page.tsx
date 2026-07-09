import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
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

// Warna badge per kategori (mengikuti mockup pengeluaran petshop).
const KAT_BADGE: Record<string, string> = {
  "Operasional": "b", "Listrik & Air": "g", "Perlengkapan": "o",
  "Transportasi": "pu", "Perawatan": "pk", "Lain-lain": "x",
};

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

      {/* Header halaman: ikon dompet + judul + subjudul (mockup pengeluaran petshop). */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{ width: 46, height: 46, borderRadius: "50%", background: "var(--posb)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-wallet" style={{ fontSize: 22, color: "#fff" }} />
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--posb)", letterSpacing: ".01em" }}>PENGELUARAN</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)", marginTop: 1 }}>Catat semua pengeluaran operasional · {shift.branchName}</div>
        </div>
      </div>

      {/* Layout dua kolom: form input kiri, daftar + ringkasan kanan. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 340px) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
        {/* KIRI — form tambah pengeluaran */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--posb)", marginBottom: 12, letterSpacing: ".03em" }}>TAMBAH PENGELUARAN</div>
          <form action={simpanPengeluaranKasir}>
            <input type="hidden" name="branchId" value={shift.branch_id} />
            <div style={{ marginBottom: 10 }}>
              <label className="flab">Tanggal *</label>
              <input className="fi" name="tanggal" type="date" defaultValue={today} required />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label className="flab">Kategori *</label>
              <select className="fi" name="kategori" required defaultValue="">
                <option value="" disabled>Pilih kategori</option>
                {KATEGORI.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label className="flab">Deskripsi</label>
              <textarea className="fi" name="deskripsi" rows={2} placeholder="Contoh: Beli air galon, bayar listrik, dll" style={{ resize: "vertical" }} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label className="flab">Jumlah (Rp) *</label>
              <div style={{ display: "flex", alignItems: "stretch" }}>
                <span style={{ background: "var(--sf1)", border: ".5px solid var(--bd)", borderRight: "none", borderRadius: "6px 0 0 6px", padding: "6px 10px", fontSize: 12, color: "var(--tm)" }}>Rp</span>
                <input className="fi" name="jumlah" type="number" min={0} step={1000} placeholder="Masukkan jumlah" required style={{ borderRadius: "0 6px 6px 0" }} />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label className="flab">Metode Pembayaran *</label>
              <select className="fi" name="metode_bayar" defaultValue="Tunai" required>
                {METODE.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {/* ponytail: upload bukti belum diwire — kolom bukti_url dibiarkan null sesuai spec. */}
            <button type="submit" className="pay-btn" style={{ width: "100%" }}>Simpan Pengeluaran</button>
          </form>
        </div>

        {/* KANAN — daftar pengeluaran + total */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--posb)", marginBottom: 12, letterSpacing: ".03em" }}>DAFTAR PENGELUARAN</div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th style={{ width: 34 }}>No.</th>
                  <th>Tanggal</th><th>Kategori</th><th>Deskripsi</th>
                  <th style={{ textAlign: "right" }}>Jumlah</th><th>Metode</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtTgl(r.tanggal)}</td>
                    <td style={{ fontSize: 11 }}><span className={`bge ${KAT_BADGE[r.kategori] ?? "x"}`}>{r.kategori}</span></td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.deskripsi || "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>{rp(Number(r.jumlah))}</td>
                    <td style={{ fontSize: 11 }}>{r.metode_bayar}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada pengeluaran tercatat.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {rows.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: ".5px solid var(--bd)" }}>
              <span style={{ fontSize: 11, color: "var(--tm)" }}>Ringkasan · Hari ini {rp(totHari)} · Bulan ini {rp(totBulan)}</span>
              <span style={{ fontSize: 11, color: "var(--tm)" }}>Total Pengeluaran <span style={{ fontSize: 16, fontWeight: 800, color: "var(--posb)", marginLeft: 6 }}>{rp(totDaftar)}</span></span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
