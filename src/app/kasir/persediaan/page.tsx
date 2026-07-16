import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { PersediaanTable, type PersRow } from "./PersediaanTable";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

type Req = {
  id: string;
  no_request: string | null;
  status: string;
  created_at: string;
  warehouses: Rel<{ code: string; name: string }>;
  requester: Rel<{ full_name: string | null }>;
  stock_request_items: { id: string }[] | null;
};

// Persediaan (dunia kasir): dua tab — Permintaan Barang (ke DC) & Penerimaan Barang (§2.4).
export default async function PersediaanKasirPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; success?: string; trm?: string; selisih?: string; error?: string }>;
}) {
  const { tab: tabParam, success, trm, selisih, error } = await searchParams;
  const tab = tabParam === "penerimaan" ? "penerimaan" : "permintaan";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const { data } = await supabase
    .from("stock_requests")
    .select("id, no_request, status, created_at, warehouses(code, name), requester:requested_by(full_name), stock_request_items(id)")
    .eq("from_branch_id", shift.branch_id)
    .order("created_at", { ascending: false });

  const reqs = (data ?? []) as unknown as Req[];
  const toRow = (r: Req): PersRow => ({
    id: r.id,
    no: r.no_request ?? "—",
    createdAt: r.created_at,
    dari: shift.branchName,
    tujuan: one(r.warehouses)?.name ?? "—",
    itemCount: r.stock_request_items?.length ?? 0,
    status: r.status,
    dibuatOleh: one(r.requester)?.full_name ?? "—",
  });
  const permintaanRows = reqs.map(toRow);
  const penerimaanRows = reqs.filter((r) => r.status === "Dikirim" || r.status === "Selesai").map(toRow);

  return (
    <>
      {/* Header halaman (ala referensi): ikon + judul + subjudul + aksi utama. */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: "var(--posb)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <i className="ti ti-building-warehouse" style={{ fontSize: 22, color: "#fff" }} />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--tx)", letterSpacing: ".01em" }}>PERSEDIAAN</div>
            <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Kelola permintaan dan penerimaan barang · {shift.branchName}</div>
          </div>
        </div>
        <Link href="/kasir/persediaan/baru" className="btn-acc" style={{ textDecoration: "none", padding: "9px 16px", fontSize: 12.5, background: "var(--posb)" }}>
          + Buat Permintaan Barang
        </Link>
      </div>

      {success === "1" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Permintaan barang berhasil dibuat.
        </div>
      )}
      {success === "terima" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Barang diterima ({trm ?? "TRM"}) & stok diperbarui sesuai qty diterima.
          {selisih && Number(selisih) !== 0 && (
            <span className="bge r" style={{ marginLeft: 8 }}>Selisih: {Number(selisih) > 0 ? "+" : ""}{selisih}</span>
          )}
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      {/* Tab nav (underline) */}
      <div style={{ display: "flex", gap: 22, marginBottom: 14, borderBottom: ".5px solid var(--bd)" }}>
        <Link href="/kasir/persediaan?tab=permintaan" className={`kpos-catTab ${tab === "permintaan" ? "on" : ""}`} style={{ textDecoration: "none", paddingBottom: 8 }}>
          Permintaan Barang
        </Link>
        <Link href="/kasir/persediaan?tab=penerimaan" className={`kpos-catTab ${tab === "penerimaan" ? "on" : ""}`} style={{ textDecoration: "none", paddingBottom: 8 }}>
          Penerimaan Barang
        </Link>
      </div>

      <div className="crm-sec">
        {tab === "permintaan"
          ? <PersediaanTable rows={permintaanRows} tab="permintaan" />
          : <PersediaanTable rows={penerimaanRows} tab="penerimaan" />}
      </div>
    </>
  );
}
