import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { StokTabs, StatCard } from "../stok/StokTabs";
import { TambahPengeluaran } from "./TambahPengeluaran";
import { hariIniWIB } from "@/lib/tanggal";

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

  const { data: profile } = await supabase.from("profiles").select("role,is_active").eq("id", user.id).single();
  const canManage = profile?.is_active && ["OWNER", "ADMIN", "FINANCE"].includes(profile.role);
  const shift = await getOpenShift(supabase as never, user.id, "klinik");
  if (!shift && profile?.role === "STAFF") redirect("/klinik/shift");
  const branchId = shift?.branch_id ?? "";

  // Daftar terfilter.
  let query = supabase
    .from("expenses")
    .select("id, tanggal, kategori, deskripsi, jumlah, metode_bayar, created_at, voided_at, profiles!expenses_created_by_fkey(full_name), branches(name)")
    .order("created_at", { ascending: false }).limit(100);
  if (branchId) query = query.eq("branch_id", branchId);
  if (from) query = query.gte("tanggal", from);
  if (to) query = query.lte("tanggal", to);
  if (kategori) query = query.eq("kategori", kategori);
  if (metode) query = query.eq("metode_bayar", metode);
  if (q) query = query.ilike("deskripsi", `%${q}%`);
  const { data: rows } = await query;

  // Lampiran bukti per baris (bucket privat → signed URL 1 jam saat render).
  const ids = (rows ?? []).map((r) => r.id);
  const buktiOf: Record<string, { url: string | null; nama: string; jumlah: number }> = {};
  // Gagal memuat lampiran tidak boleh menjatuhkan daftar pengeluaran — kolom Bukti saja yang kosong.
  if (ids.length) try {
    const { data: lampiran } = await supabase
      .from("document_attachments").select("ref_id, path, nama, created_at")
      .eq("modul", "pengeluaran").in("ref_id", ids).order("created_at", { ascending: true });
    const daftar = (lampiran ?? []) as { ref_id: string; path: string; nama: string }[];
    const { data: signed } = daftar.length
      ? await supabase.storage.from("dokumen").createSignedUrls(daftar.map((l) => l.path), 3600)
      : { data: [] as { path: string | null; signedUrl: string }[] };
    const urlOf = new Map((signed ?? []).filter((x) => x.path && x.signedUrl).map((x) => [x.path as string, x.signedUrl]));
    for (const l of daftar) {
      const ada = buktiOf[l.ref_id];
      if (ada) ada.jumlah += 1;
      else buktiOf[l.ref_id] = { url: urlOf.get(l.path) ?? null, nama: l.nama, jumlah: 1 };
    }
  } catch { /* kolom Bukti tampil "—" */ }

  // Stat: hari / bulan / tahun (dari cabang ini).
  // Tanggal WIB (server Vercel berjalan di UTC — sebelum jam 07.00 WIB "hari ini" dulu masih kemarin).
  const startDay = hariIniWIB();
  const startMonth = `${startDay.slice(0, 7)}-01`;
  const startYear = `${startDay.slice(0, 4)}-01-01`;
  let statQ = supabase.from("expenses").select("tanggal, jumlah");
  if (branchId) statQ = statQ.eq("branch_id", branchId);
  const { data: all } = await statQ.gte("tanggal", startYear);
  const sum = (fromDate: string) => (all ?? []).filter((e) => e.tanggal >= fromDate).reduce((a, e) => a + Number(e.jumlah), 0);

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric" });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/klinik" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
      </div>
      <StokTabs active="pengeluaran" action={<TambahPengeluaran key={`${user.id}:${shift?.id ?? "none"}`} userId={user.id} shiftId={shift?.id ?? null} today={startDay} />} />

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Pengeluaran tersimpan.</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 14 }}>
        <StatCard label="Total Pengeluaran Hari Ini" value={rp(sum(startDay))} color="var(--posb)" bg="#eff6ff" icon="ti-receipt" />
        <StatCard label="Total Pengeluaran Bulan Ini" value={rp(sum(startMonth))} color="#16a34a" bg="#e8f5ee" icon="ti-chart-bar" />
        <StatCard label="Total Pengeluaran Tahun Ini" value={rp(sum(startYear))} color="#7c3aed" bg="#f3f0ff" icon="ti-chart-pie" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14, alignItems: "start" }}>
        {/* Filter sidebar (GET) */}
        <form method="GET" className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "var(--posb)", marginBottom: 12 }}>FILTER PENGELUARAN</div>
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
          <button type="submit" className="btn-acc" style={{ width: "100%", justifyContent: "center", background: "var(--posb)", marginTop: 4 }}><i className="ti ti-filter" /> Terapkan Filter</button>
          <Link href="/klinik/pengeluaran" className="btn-def" style={{ width: "100%", justifyContent: "center", display: "inline-flex", alignItems: "center", gap: 5, marginTop: 6, textDecoration: "none" }}><i className="ti ti-refresh" /> Reset Filter</Link>
        </form>

        {/* Tabel */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--posb)", marginBottom: 12 }}>DAFTAR PENGELUARAN</div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 780 }}>
              <thead><tr><th style={{ width: 30 }}>No.</th><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th style={{ textAlign: "right" }}>Jumlah</th><th>Metode</th><th>Bukti</th><th>Dibuat Oleh</th></tr></thead>
              <tbody>
                {(rows ?? []).map((r, i) => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                    <td style={{ fontSize: 11 }}>{fmtDate(r.tanggal)}<div style={{ fontSize: 9.5, color: "var(--td)" }}>{fmtTime(r.created_at)}</div></td>
                    <td><span className={`bge ${KAT_BADGE[r.kategori] ?? "x"}`}>{r.kategori}</span></td>
                    <td style={{ fontSize: 11.5 }}>{r.deskripsi ?? "—"}
                      {r.voided_at && <span className="bge r" style={{ marginLeft: 5 }}>Dibatalkan</span>}
                      {canManage && <div><Link href={`/buku-besar/beban/${r.id}`}>Detail / koreksi</Link></div>}
                    </td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(Number(r.jumlah))}</td>
                    <td><span className={`bge ${r.metode_bayar === "Tunai" ? "g" : "b"}`}>{r.metode_bayar}</span></td>
                    <td style={{ fontSize: 11 }}>{(() => {
                      const b = buktiOf[r.id];
                      if (!b) return <span style={{ color: "var(--td)" }}>—</span>;
                      const label = <><i className="ti ti-paperclip" /> Lihat{b.jumlah > 1 ? ` (${b.jumlah})` : ""}</>;
                      return b.url ? <a href={b.url} target="_blank" rel="noopener noreferrer" title={b.nama}>{label}</a> : <span title={b.nama}>{label}</span>;
                    })()}</td>
                    <td style={{ fontSize: 11 }}>{one(r.profiles as Rel<{ full_name: string | null }>)?.full_name ?? "—"}</td>
                  </tr>
                ))}
                {(rows ?? []).length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>Belum ada pengeluaran.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
