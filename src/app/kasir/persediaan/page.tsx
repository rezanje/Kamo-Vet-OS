import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { SecHeader } from "@/components/SecHeader";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const STATUS_BADGE: Record<string, string> = {
  "Menunggu Persetujuan": "o",
  Disetujui: "b",
  Dikirim: "b",
  Selesai: "g",
  Ditolak: "r",
};

type Req = {
  id: string;
  no_request: string | null;
  status: string;
  created_at: string;
  warehouses: Rel<{ code: string; name: string }>;
  stock_request_items: { id: string }[] | null;
};

const fmtDt = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// Persediaan (dunia kasir): dua tab — Permintaan Barang (ke DC) & Penerimaan Barang (§2.4).
export default async function PersediaanKasirPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; success?: string }>;
}) {
  const { tab: tabParam, success } = await searchParams;
  const tab = tabParam === "penerimaan" ? "penerimaan" : "permintaan";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const { data } = await supabase
    .from("stock_requests")
    .select("id, no_request, status, created_at, warehouses(code, name), stock_request_items(id)")
    .eq("from_branch_id", shift.branch_id)
    .order("created_at", { ascending: false });

  const reqs = (data ?? []) as unknown as Req[];
  const penerimaanList = reqs.filter((r) => r.status === "Dikirim" || r.status === "Selesai");

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Persediaan · {shift.branchName}</span>
      </div>

      {success === "1" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Permintaan barang berhasil dibuat.
        </div>
      )}
      {success === "terima" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Barang diterima & stok telah diperbarui.
        </div>
      )}

      {/* Tab nav */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <Link
          href="/kasir/persediaan?tab=permintaan"
          className={tab === "permintaan" ? "btn-acc" : "btn-def"}
          style={{ textDecoration: "none", padding: "5px 14px", fontSize: 11.5 }}
        >
          <i className="ti ti-clipboard-list" /> Permintaan Barang
        </Link>
        <Link
          href="/kasir/persediaan?tab=penerimaan"
          className={tab === "penerimaan" ? "btn-acc" : "btn-def"}
          style={{ textDecoration: "none", padding: "5px 14px", fontSize: 11.5 }}
        >
          <i className="ti ti-package-import" /> Penerimaan Barang
        </Link>
      </div>

      {tab === "permintaan" && (
        <div className="crm-sec">
          <SecHeader
            num="01"
            title="PERMINTAAN BARANG"
            desc="Permintaan stok dari cabang ini ke DC / gudang tujuan (PRD §2.4)."
            action={
              <Link href="/kasir/persediaan/baru" className="btn-acc" style={{ textDecoration: "none" }}>
                + Buat Permintaan
              </Link>
            }
          />

          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th>No. Request</th>
                  <th>Tanggal</th>
                  <th>Ke Gudang</th>
                  <th style={{ textAlign: "center" }}>Item</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {reqs.map((r) => {
                  const wh = one(r.warehouses);
                  const itemCount = r.stock_request_items?.length ?? 0;
                  return (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 500, fontSize: 11.5 }}>{r.no_request ?? "—"}</td>
                      <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDt(r.created_at)}</td>
                      <td style={{ fontSize: 11.5 }}>{wh?.name ?? "—"}</td>
                      <td style={{ textAlign: "center", fontSize: 11.5 }}>{itemCount}</td>
                      <td><span className={`bge ${STATUS_BADGE[r.status] ?? "x"}`}>{r.status}</span></td>
                    </tr>
                  );
                })}
                {reqs.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                      Belum ada permintaan barang.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "penerimaan" && (
        <div className="crm-sec">
          <SecHeader
            num="01"
            title="PENERIMAAN BARANG"
            desc="Permintaan yang sudah dikirim & siap diterima, plus riwayat yang selesai."
          />

          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th>No. Request</th>
                  <th>Tanggal</th>
                  <th>Ke Gudang</th>
                  <th style={{ textAlign: "center" }}>Item</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {penerimaanList.map((r) => {
                  const wh = one(r.warehouses);
                  const itemCount = r.stock_request_items?.length ?? 0;
                  return (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 500, fontSize: 11.5 }}>{r.no_request ?? "—"}</td>
                      <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDt(r.created_at)}</td>
                      <td style={{ fontSize: 11.5 }}>{wh?.name ?? "—"}</td>
                      <td style={{ textAlign: "center", fontSize: 11.5 }}>{itemCount}</td>
                      <td><span className={`bge ${STATUS_BADGE[r.status] ?? "x"}`}>{r.status}</span></td>
                      <td>
                        {r.status === "Dikirim" ? (
                          <Link href={`/kasir/persediaan/terima/${r.id}`} className="btn-acc" style={{ textDecoration: "none", padding: "4px 10px", fontSize: 10.5 }}>
                            <i className="ti ti-package-import" /> Terima
                          </Link>
                        ) : (
                          <span style={{ fontSize: 10.5, color: "var(--td)" }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {penerimaanList.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                      Belum ada barang yang perlu diterima.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
