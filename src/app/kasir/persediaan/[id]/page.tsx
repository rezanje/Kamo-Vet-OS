import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const BADGE: Record<string, string> = {
  "Menunggu Persetujuan": "b", Disetujui: "g", Dikirim: "o", Selesai: "g", Ditolak: "r",
};
const fmtDt = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

type Detail = {
  id: string;
  no_request: string | null;
  status: string;
  created_at: string;
  priority: string | null;
  catatan: string | null;
  from_branch_id: string;
  warehouses: Rel<{ name: string }>;
  requester: Rel<{ full_name: string | null }>;
  stock_request_items: {
    id: string; nama: string; qty_diminta: number; qty_diterima: number | null; kondisi: string | null; catatan: string | null;
  }[] | null;
};

export default async function PersediaanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const { data } = await supabase
    .from("stock_requests")
    .select("id, no_request, status, created_at, priority, catatan, from_branch_id, warehouses(name), requester:requested_by(full_name), stock_request_items(id, nama, qty_diminta, qty_diterima, kondisi, catatan)")
    .eq("id", id)
    .maybeSingle();

  const req = data as unknown as Detail | null;
  if (!req) notFound();
  if (req.from_branch_id !== shift.branch_id) redirect("/kasir/persediaan");

  const wh = one(req.warehouses);
  const requester = one(req.requester);
  const items = req.stock_request_items ?? [];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <Link href="/kasir/persediaan?tab=permintaan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke Persediaan</Link>
        {req.status === "Dikirim" && (
          <Link href={`/kasir/persediaan/terima/${req.id}`} className="btn-acc" style={{ textDecoration: "none", background: "var(--posb)" }}>
            <i className="ti ti-package-import" /> Terima Barang
          </Link>
        )}
      </div>

      <div className="crm-sec">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingBottom: 12, borderBottom: ".5px solid var(--bd)", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--posb)" }}>{req.no_request ?? "—"}</div>
            <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>{fmtDt(req.created_at)}</div>
          </div>
          <span className={`bge ${BADGE[req.status] ?? "x"}`} style={{ fontSize: 11, padding: "4px 12px" }}>{req.status}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 6 }}>
          <Info label="Dari (Toko)" value={shift.branchName} />
          <Info label="Tujuan (Gudang)" value={wh?.name ?? "—"} />
          <Info label="Dibuat Oleh" value={requester?.full_name ?? "—"} />
          <Info label="Prioritas" value={req.priority === "tinggi" ? "Tinggi" : "Normal"} />
        </div>
        {req.catatan && <Info label="Catatan" value={req.catatan} />}
      </div>

      <div className="crm-sec">
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tx)", marginBottom: 12 }}>
          Daftar Barang <span style={{ fontSize: 11, color: "var(--td)", fontWeight: 400 }}>({items.length} item)</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 600 }}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>No.</th>
                <th>Nama Barang</th>
                <th style={{ textAlign: "center" }}>Qty Diminta</th>
                <th style={{ textAlign: "center" }}>Qty Diterima</th>
                <th>Kondisi</th>
                <th>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 500 }}>{it.nama}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{Number(it.qty_diminta)}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{it.qty_diterima != null ? Number(it.qty_diterima) : "—"}</td>
                  <td style={{ fontSize: 11 }}>{it.kondisi ?? "—"}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{it.catatan ?? "—"}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>Tidak ada barang.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--td)", letterSpacing: ".03em", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--tx)" }}>{value}</div>
    </div>
  );
}
