import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { StokTabs, StatCard } from "../stok/StokTabs";
import { TambahPengeluaran } from "./TambahPengeluaran";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null { return Array.isArray(r) ? (r[0] ?? null) : r; }
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

const KATEGORI = ["Operasional", "Listrik & Air", "Perlengkapan", "Transportasi", "Perawatan", "Lain-lain"];
const KAT_BADGE: Record<string, string> = {
  "Operasional": "b", "Listrik & Air": "g", "Perlengkapan": "o", "Transportasi": "pu", "Perawatan": "pk", "Lain-lain": "x",
};

export default async function KlinikPengeluaranPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; from?: string; to?: string; kategori?: string; metode?: string; q?: string }>;
}) {
  const { error, success, from, to, kategori, metode, q } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const shift = await getOpenShift(supabase as never, user.id, "klinik");
  if (!shift && profile?.role === "STAFF") redirect("/klinik/shift");
  const branchId = shift?.branch_id ?? "";

  // Daftar terfilter.
  let query = supabase
    .from("expenses")
    .select("id, tanggal, kategori, deskripsi, jumlah, metode_bayar, created_at, profiles(full_name), branches(name)")
    .order("created_at", { ascending: false }).limit(100);
  if (branchId) query = query.eq("branch_id", branchId);
  if (from) query = query.gte("tanggal", from);
  if (to) query = query.lte("tanggal", to);
  if (kategori) query = query.eq("kategori", kategori);
  if (metode) query = query.eq("metode_bayar", metode);
  if (q) query = query.ilike("deskripsi", `%${q}%`);
  const { data: rows } = await query;

  // Stat: hari / bulan / tahun (dari cabang ini).
  const now = new Date();
  const yyyy = now.getFullYear();
  const startDay = `${yyyy}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const startMonth = `${yyyy}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const startYear = `${yyyy}-01-01`;
  let statQ = supabase.from("expenses").select("tanggal, jumlah");
  if (branchId) statQ = statQ.eq("branch_id", branchId);
  const { data: all } = await statQ.gte("tanggal", startYear);
  const sum = (fromDate: string) => (all ?? []).filter((e) => e.tanggal >= fromDate).reduce((a, e) => a + Number(e.jumlah), 0);

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/klinik" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
      </div>
      <StokTabs active="pengeluaran" action={<TambahPengeluaran branchId={branchId} today={startDay} />} />

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Pengeluaran tersimpan.</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 14 }}>
        <StatCard label="Total Pengeluaran Hari Ini" value={rp(sum(startDay))} color="#2563eb" bg="#eff6ff" icon="ti-receipt" />
        <StatCard label="Total Pengeluaran Bulan Ini" value={rp(sum(startMonth))} color="#16a34a" bg="#e8f5ee" icon="ti-chart-bar" />
        <StatCard label="Total Pengeluaran Tahun Ini" value={rp(sum(startYear))} color="#7c3aed" bg="#f3f0ff" icon="ti-chart-pie" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14, alignItems: "start" }}>
        {/* Filter sidebar (GET) */}
        <form method="GET" className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#2563eb", marginBottom: 12 }}>FILTER PENGELUARAN</div>
          <div className="fg"><label className="flab">Dari tanggal</label><input className="fi" name="from" type="date" defaultValue={from} /></div>
          <div className="fg"><label className="flab">Sampai tanggal</label><input className="fi" name="to" type="date" defaultValue={to} /></div>
          <div className="fg">
            <label className="flab">Kategori</label>
            <select className="fi" name="kategori" defaultValue={kategori ?? ""}>
              <option value="">Semua Kategori</option>
              {KATEGORI.map((k) => <option key={k}>{k}</option>)}
            </select>
          </div>
          <div className="fg">
            <label className="flab">Metode Pembayaran</label>
            <select className="fi" name="metode" defaultValue={metode ?? ""}>
              <option value="">Semua Metode</option>
              <option>Tunai</option><option>Transfer</option><option>Debit</option><option>QRIS</option>
            </select>
          </div>
          <div className="fg"><label className="flab">Deskripsi</label><input className="fi" name="q" defaultValue={q} placeholder="Cari deskripsi…" /></div>
          <button type="submit" className="btn-acc" style={{ width: "100%", justifyContent: "center", background: "#2563eb", marginTop: 4 }}><i className="ti ti-filter" /> Terapkan Filter</button>
          <Link href="/klinik/pengeluaran" className="btn-def" style={{ width: "100%", justifyContent: "center", display: "inline-flex", alignItems: "center", gap: 5, marginTop: 6, textDecoration: "none" }}><i className="ti ti-refresh" /> Reset Filter</Link>
        </form>

        {/* Tabel */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#2563eb", marginBottom: 12 }}>DAFTAR PENGELUARAN</div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 720 }}>
              <thead><tr><th style={{ width: 30 }}>No.</th><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th style={{ textAlign: "right" }}>Jumlah</th><th>Metode</th><th>Dibuat Oleh</th></tr></thead>
              <tbody>
                {(rows ?? []).map((r, i) => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                    <td style={{ fontSize: 11 }}>{fmtDate(r.tanggal)}<div style={{ fontSize: 9.5, color: "var(--td)" }}>{fmtTime(r.created_at)}</div></td>
                    <td><span className={`bge ${KAT_BADGE[r.kategori] ?? "x"}`}>{r.kategori}</span></td>
                    <td style={{ fontSize: 11.5 }}>{r.deskripsi ?? "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(Number(r.jumlah))}</td>
                    <td><span className={`bge ${r.metode_bayar === "Tunai" ? "g" : "b"}`}>{r.metode_bayar}</span></td>
                    <td style={{ fontSize: 11 }}>{one(r.profiles as Rel<{ full_name: string | null }>)?.full_name ?? "—"}</td>
                  </tr>
                ))}
                {(rows ?? []).length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>Belum ada pengeluaran.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
