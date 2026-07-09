import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { StokTabs, StatCard } from "../stok/StokTabs";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null { return Array.isArray(r) ? (r[0] ?? null) : r; }
function many<T>(r: Rel<T>): T[] { return Array.isArray(r) ? r : r ? [r] : []; }

export default async function KlinikPenerimaanPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const shift = await getOpenShift(supabase as never, user.id, "klinik");
  if (!shift && profile?.role === "STAFF") redirect("/klinik/shift");
  const branchId = shift?.branch_id ?? "";

  // Perlu diterima: permintaan Disetujui / Dikirim untuk cabang ini.
  let pendingQ = supabase
    .from("stock_requests")
    .select("id, no_request, status, created_at, branches(name), warehouses(name), stock_request_items(id)")
    .in("status", ["Disetujui", "Dikirim"]).order("created_at", { ascending: false });
  if (branchId) pendingQ = pendingQ.eq("from_branch_id", branchId);
  const { data: pending } = await pendingQ;

  // Riwayat penerimaan.
  const { data: receipts } = await supabase
    .from("stock_receipts")
    .select("id, receipt_number, received_at, stock_requests(no_request, from_branch_id, branches(name)), stock_receipt_items(id, qty_received), profiles(full_name)")
    .order("received_at", { ascending: false }).limit(100);
  const receiptRows = (receipts ?? []).filter((r) => {
    if (!branchId) return true;
    const req = one(r.stock_requests as Rel<{ from_branch_id: string }>);
    return req?.from_branch_id === branchId;
  });

  const fmt = (iso: string) => new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/klinik" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
      </div>
      <StokTabs active="penerimaan" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 14 }}>
        <StatCard label="Perlu Diterima" value={String((pending ?? []).length)} color="#d97706" bg="#fffbeb" icon="ti-package-import" big />
        <StatCard label="Total Penerimaan" value={String(receiptRows.length)} color="#16a34a" bg="#e8f5ee" icon="ti-checks" big />
        <StatCard label="Cabang" value={shift?.branchName ?? "—"} color="#2563eb" bg="#eff6ff" icon="ti-building-store" big />
      </div>

      {/* Perlu diterima */}
      <div className="crm-sec">
        <div style={{ fontSize: 13, fontWeight: 800, color: "#2563eb", marginBottom: 12 }}>BARANG PERLU DITERIMA</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead><tr><th style={{ width: 30 }}>No.</th><th>No. Permintaan</th><th>Tanggal</th><th>Dari Gudang</th><th>Total Item</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
              {(pending ?? []).map((r, i) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600, color: "#2563eb" }}>{r.no_request ?? "—"}</td>
                  <td style={{ fontSize: 11 }}>{fmt(r.created_at)}</td>
                  <td style={{ fontSize: 11.5 }}>{one(r.warehouses as Rel<{ name: string }>)?.name ?? "—"}</td>
                  <td style={{ fontSize: 11.5 }}>{many(r.stock_request_items as Rel<{ id: string }>).length} Item</td>
                  <td><span className={`bge ${r.status === "Dikirim" ? "b" : "g"}`}>{r.status}</span></td>
                  <td>
                    <Link href={`/klinik/penerimaan/terima/${r.id}`} className="btn-acc" style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none", background: "#16a34a" }}>
                      <i className="ti ti-package-import" /> Terima
                    </Link>
                  </td>
                </tr>
              ))}
              {(pending ?? []).length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>Tidak ada barang menunggu penerimaan.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Riwayat */}
      <div className="crm-sec" style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#2563eb", marginBottom: 12 }}>RIWAYAT PENERIMAAN</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 680 }}>
            <thead><tr><th style={{ width: 30 }}>No.</th><th>No. Penerimaan</th><th>No. Permintaan</th><th>Tanggal Terima</th><th>Total Item</th><th>Diterima Oleh</th></tr></thead>
            <tbody>
              {receiptRows.map((r, i) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.receipt_number}</td>
                  <td style={{ fontSize: 11.5, color: "#2563eb" }}>{one(r.stock_requests as Rel<{ no_request: string }>)?.no_request ?? "—"}</td>
                  <td style={{ fontSize: 11 }}>{fmt(r.received_at)}</td>
                  <td style={{ fontSize: 11.5 }}>{many(r.stock_receipt_items as Rel<{ id: string }>).length} Item</td>
                  <td style={{ fontSize: 11 }}>{one(r.profiles as Rel<{ full_name: string | null }>)?.full_name ?? "—"}</td>
                </tr>
              ))}
              {receiptRows.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>Belum ada riwayat penerimaan.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
