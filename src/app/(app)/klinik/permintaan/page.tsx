import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { StokTabs, StatCard } from "../stok/StokTabs";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null { return Array.isArray(r) ? (r[0] ?? null) : r; }
function many<T>(r: Rel<T>): T[] { return Array.isArray(r) ? r : r ? [r] : []; }

const STATUS_BADGE: Record<string, string> = {
  "Menunggu Persetujuan": "o", "Disetujui": "g", "Dikirim": "b", "Selesai": "pu", "Ditolak": "r",
};
const PRIO_BADGE: Record<string, string> = { normal: "b", tinggi: "r", rendah: "x" };
const PRIO_LABEL: Record<string, string> = { normal: "Normal", tinggi: "Tinggi", rendah: "Rendah" };

export default async function KlinikPermintaanPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; priority?: string; from?: string; to?: string; q?: string }>;
}) {
  const { status, priority, from, to, q } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const shift = await getOpenShift(supabase as never, user.id, "klinik");
  if (!shift && profile?.role === "STAFF") redirect("/klinik/shift");
  const branchId = shift?.branch_id ?? "";

  let query = supabase
    .from("stock_requests")
    .select("id, no_request, status, priority, catatan, created_at, from_branch_id, branches(name), warehouses(name), stock_request_items(id), profiles!requested_by(full_name, role)")
    .order("created_at", { ascending: false }).limit(100);
  if (branchId) query = query.eq("from_branch_id", branchId);
  if (status) query = query.eq("status", status);
  if (priority) query = query.eq("priority", priority);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", `${to}T23:59:59`);
  if (q) query = query.ilike("no_request", `%${q}%`);
  const { data: rows } = await query;

  // Stat (cabang ini, semua waktu).
  let statQ = supabase.from("stock_requests").select("status");
  if (branchId) statQ = statQ.eq("from_branch_id", branchId);
  const { data: all } = await statQ;
  const c = (s: string) => (all ?? []).filter((r) => r.status === s).length;

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/klinik" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
      </div>
      <StokTabs active="permintaan" action={
        <Link href="/klinik/permintaan/baru" className="btn-acc" style={{ background: "#2563eb", padding: "8px 16px", textDecoration: "none" }}><i className="ti ti-plus" /> Tambah Permintaan Barang</Link>
      } />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 14 }}>
        <StatCard label="Total Permintaan" value={String((all ?? []).length)} color="#2563eb" bg="#eff6ff" icon="ti-file-text" big />
        <StatCard label="Menunggu Persetujuan" value={String(c("Menunggu Persetujuan"))} color="#d97706" bg="#fffbeb" icon="ti-hourglass" big />
        <StatCard label="Disetujui" value={String(c("Disetujui"))} color="#16a34a" bg="#e8f5ee" icon="ti-circle-check" big />
        <StatCard label="Ditolak" value={String(c("Ditolak"))} color="#b91c1c" bg="#fef2f2" icon="ti-circle-x" big />
        <StatCard label="Selesai" value={String(c("Selesai"))} color="#7c3aed" bg="#f3f0ff" icon="ti-clipboard-check" big />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14, alignItems: "start" }}>
        <form method="GET" className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#2563eb", marginBottom: 12 }}>FILTER PERMINTAAN</div>
          <div className="fg"><label className="flab">Dari tanggal</label><input className="fi" name="from" type="date" defaultValue={from} /></div>
          <div className="fg"><label className="flab">Sampai tanggal</label><input className="fi" name="to" type="date" defaultValue={to} /></div>
          <div className="fg">
            <label className="flab">Status</label>
            <select className="fi" name="status" defaultValue={status ?? ""}>
              <option value="">Semua Status</option>
              {Object.keys(STATUS_BADGE).map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="fg">
            <label className="flab">Prioritas</label>
            <select className="fi" name="priority" defaultValue={priority ?? ""}>
              <option value="">Semua Prioritas</option>
              <option value="normal">Normal</option><option value="tinggi">Tinggi</option><option value="rendah">Rendah</option>
            </select>
          </div>
          <div className="fg"><label className="flab">Cari no. permintaan</label><input className="fi" name="q" defaultValue={q} placeholder="PRM-…" /></div>
          <button type="submit" className="btn-acc" style={{ width: "100%", justifyContent: "center", background: "#2563eb", marginTop: 4 }}><i className="ti ti-filter" /> Terapkan Filter</button>
          <Link href="/klinik/permintaan" className="btn-def" style={{ width: "100%", justifyContent: "center", display: "inline-flex", alignItems: "center", gap: 5, marginTop: 6, textDecoration: "none" }}><i className="ti ti-refresh" /> Reset Filter</Link>
        </form>

        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#2563eb", marginBottom: 12 }}>DAFTAR PERMINTAAN BARANG</div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 820 }}>
              <thead><tr><th style={{ width: 30 }}>No.</th><th>No. Permintaan</th><th>Tanggal</th><th>Tujuan / Cabang</th><th>Diajukan Oleh</th><th>Prioritas</th><th>Status</th><th>Total Item</th></tr></thead>
              <tbody>
                {(rows ?? []).map((r, i) => {
                  const by = one(r.profiles as Rel<{ full_name: string | null; role: string | null }>);
                  const br = one(r.branches as Rel<{ name: string }>);
                  const items = many(r.stock_request_items as Rel<{ id: string }>);
                  const prio = (r.priority as string) ?? "normal";
                  return (
                    <tr key={r.id}>
                      <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                      <td style={{ fontSize: 11.5, fontWeight: 600, color: "#2563eb" }}>{r.no_request ?? "—"}</td>
                      <td style={{ fontSize: 11 }}>{fmtDate(r.created_at)}<div style={{ fontSize: 9.5, color: "var(--td)" }}>{fmtTime(r.created_at)}</div></td>
                      <td style={{ fontSize: 11.5 }}>{br?.name ?? one(r.warehouses as Rel<{ name: string }>)?.name ?? "—"}</td>
                      <td style={{ fontSize: 11.5 }}>{by?.full_name ?? "—"}<div style={{ fontSize: 9.5, color: "var(--td)" }}>{by?.role ?? ""}</div></td>
                      <td><span className={`bge ${PRIO_BADGE[prio] ?? "b"}`}>{PRIO_LABEL[prio] ?? prio}</span></td>
                      <td><span className={`bge ${STATUS_BADGE[r.status] ?? "x"}`}>{r.status}</span></td>
                      <td style={{ fontSize: 11.5 }}>{items.length} Item</td>
                    </tr>
                  );
                })}
                {(rows ?? []).length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>Belum ada permintaan barang.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
