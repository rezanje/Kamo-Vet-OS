import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { updateRequestStatus } from "./actions";

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
  branches: Rel<{ code: string; name: string }>;
  warehouses: Rel<{ code: string; name: string }>;
  stock_request_items: { id: string }[] | null;
};

const fmtDt = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function PermintaanPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const { success } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from("stock_requests")
    .select("id, no_request, status, created_at, branches(code, name), warehouses(code, name), stock_request_items(id)")
    .order("created_at", { ascending: false });

  const reqs = (data ?? []) as unknown as Req[];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Permintaan Barang</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Permintaan barang berhasil dibuat.
        </div>
      )}

      <div className="crm-sec">
        <SecHeader
          num="01"
          title="PERMINTAAN BARANG"
          desc="Permintaan stok antar cabang & gudang (PRD §2.4)."
          action={
            <Link href="/pos/permintaan/baru" className="btn-acc" style={{ textDecoration: "none" }}>
              + Buat permintaan
            </Link>
          }
        />

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th>No. Request</th>
                <th>Tanggal</th>
                <th>Dari Cabang</th>
                <th>Ke Gudang</th>
                <th style={{ textAlign: "center" }}>Item</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {reqs.map((r) => {
                const br = one(r.branches);
                const wh = one(r.warehouses);
                const itemCount = r.stock_request_items?.length ?? 0;
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 500, fontSize: 11.5 }}>{r.no_request ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDt(r.created_at)}</td>
                    <td style={{ fontSize: 11.5 }}>{br?.name ?? "—"}</td>
                    <td style={{ fontSize: 11.5 }}>{wh?.name ?? "—"}</td>
                    <td style={{ textAlign: "center", fontSize: 11.5 }}>{itemCount}</td>
                    <td><span className={`bge ${STATUS_BADGE[r.status] ?? "x"}`}>{r.status}</span></td>
                    <td>
                      <div style={{ display: "flex", gap: 5 }}>
                        {r.status === "Menunggu Persetujuan" && (
                          <>
                            <form action={updateRequestStatus}>
                              <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="status" value="Disetujui" />
                              <button type="submit" className="btn-acc" style={{ padding: "4px 10px", fontSize: 10.5 }}>Setujui</button>
                            </form>
                            <form action={updateRequestStatus}>
                              <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="status" value="Ditolak" />
                              <button type="submit" className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5, color: "#b91c1c" }}>Tolak</button>
                            </form>
                          </>
                        )}
                        {r.status === "Disetujui" && (
                          <form action={updateRequestStatus}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="status" value="Dikirim" />
                            <button type="submit" className="btn-acc" style={{ padding: "4px 10px", fontSize: 10.5 }}>
                              <i className="ti ti-truck-delivery" /> Tandai Dikirim
                            </button>
                          </form>
                        )}
                        {r.status === "Dikirim" && (
                          <form action={updateRequestStatus}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="status" value="Selesai" />
                            <button type="submit" className="btn-acc" style={{ padding: "4px 10px", fontSize: 10.5 }}>
                              <i className="ti ti-circle-check" /> Terima / Selesai
                            </button>
                          </form>
                        )}
                        {(r.status === "Selesai" || r.status === "Ditolak") && (
                          <span style={{ fontSize: 10.5, color: "var(--td)" }}>—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {reqs.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    Belum ada permintaan barang.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
