import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { setujuiPermintaan, updateRequestStatus } from "../actions";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const BADGE: Record<string, string> = {
  "Menunggu Persetujuan": "o", Disetujui: "b", Dikirim: "b", Selesai: "g", Ditolak: "r",
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
  branches: Rel<{ name: string }>;
  warehouses: Rel<{ name: string }>;
  stock_request_items: {
    id: string; nama: string; satuan: string | null;
    qty_diminta: number; qty_disetujui: number | null; qty_diterima: number | null;
    kondisi: string | null; catatan: string | null;
  }[] | null;
};

export default async function PermintaanDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const { success, error } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from("stock_requests")
    .select("id, no_request, status, created_at, priority, catatan, branches(name), warehouses(name), stock_request_items(id, nama, satuan, qty_diminta, qty_disetujui, qty_diterima, kondisi, catatan)")
    .eq("id", id)
    .maybeSingle();

  const req = data as unknown as Detail | null;
  if (!req) notFound();

  const items = req.stock_request_items ?? [];
  const menunggu = req.status === "Menunggu Persetujuan";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos/permintaan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{req.no_request ?? "Permintaan Barang"}</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Permintaan disetujui dengan jumlah yang kamu tetapkan.
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <div className="crm-sec">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingBottom: 12, borderBottom: ".5px solid var(--bd)", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{req.no_request ?? "—"}</div>
            <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>{fmtDt(req.created_at)}</div>
          </div>
          <span className={`bge ${BADGE[req.status] ?? "x"}`} style={{ fontSize: 11, padding: "4px 12px" }}>{req.status}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Info label="Dari (Cabang)" value={one(req.branches)?.name ?? "—"} />
          <Info label="Tujuan (Gudang)" value={one(req.warehouses)?.name ?? "—"} />
          <Info label="Prioritas" value={req.priority === "tinggi" ? "Tinggi" : "Normal"} />
          <Info label="Catatan" value={req.catatan ?? "—"} />
        </div>
      </div>

      <form action={setujuiPermintaan}>
        <input type="hidden" name="id" value={req.id} />
        <div className="crm-sec">
          <SecHeader
            num="01"
            title="DAFTAR BARANG"
            desc={menunggu
              ? "Sesuaikan jumlah yang benar-benar dikirim — stok gudang tidak selalu cukup."
              : "Jumlah yang disetujui gudang & yang akhirnya diterima toko."}
          />

          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ width: 34 }}>No.</th>
                  <th>Nama Barang</th>
                  <th>Satuan</th>
                  <th style={{ textAlign: "center" }}>Diminta</th>
                  <th style={{ textAlign: "center", width: 120 }}>Disetujui</th>
                  <th style={{ textAlign: "center" }}>Diterima</th>
                  <th>Catatan</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.id}>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                    <td style={{ fontSize: 11.5, fontWeight: 500 }}>{it.nama}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{it.satuan ?? "—"}</td>
                    <td style={{ textAlign: "center", fontSize: 11.5 }}>{Number(it.qty_diminta)}</td>
                    <td style={{ textAlign: "center" }}>
                      {menunggu ? (
                        <input
                          className="fi" type="number" min={0} step="any"
                          name={`qty_${it.id}`}
                          defaultValue={it.qty_disetujui ?? it.qty_diminta}
                          style={{ width: 80, textAlign: "center" }}
                        />
                      ) : (
                        <span style={{ fontSize: 11.5 }}>{it.qty_disetujui != null ? Number(it.qty_disetujui) : "—"}</span>
                      )}
                    </td>
                    <td style={{ textAlign: "center", fontSize: 11.5 }}>{it.qty_diterima != null ? Number(it.qty_diterima) : "—"}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{it.catatan ?? "—"}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>Tidak ada barang.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {menunggu && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button type="submit" className="btn-acc">
                <i className="ti ti-check" /> Setujui dengan jumlah ini
              </button>
            </div>
          )}
        </div>
      </form>

      {menunggu && (
        <form action={updateRequestStatus} style={{ display: "flex", justifyContent: "flex-end" }}>
          <input type="hidden" name="id" value={req.id} />
          <input type="hidden" name="status" value="Ditolak" />
          <button type="submit" className="btn-def" style={{ color: "#b91c1c" }}>
            <i className="ti ti-x" /> Tolak permintaan
          </button>
        </form>
      )}
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--td)", letterSpacing: ".03em", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{value}</div>
    </div>
  );
}
