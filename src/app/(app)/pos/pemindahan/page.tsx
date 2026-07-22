import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";

const STATUS_BADGE: Record<string, string> = {
  "Sedang dikirim": "b",
  "Diterima Sebagian": "o",
  "Diterima Seluruhnya": "g",
  Dibatalkan: "r",
};

type Wh = { code: string; name: string } | null;
type Row = {
  id: string;
  no_pemindahan: string;
  proses: string;
  tanggal: string;
  status: string | null;
  keterangan: string | null;
  from: Wh;
  to: Wh;
  stock_transfer_items: { id: string }[] | null;
};

const fmtD = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export default async function PemindahanPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string; proses?: string; status?: string; gudang?: string }>;
}) {
  const { success, error, proses, status, gudang } = await searchParams;
  const supabase = await createClient();

  let q = supabase
    .from("stock_transfers")
    .select(
      "id, no_pemindahan, proses, tanggal, status, keterangan, " +
        "from:warehouses!stock_transfers_from_warehouse_id_fkey(code, name), " +
        "to:warehouses!stock_transfers_to_warehouse_id_fkey(code, name), " +
        "stock_transfer_items(id)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (proses) q = q.eq("proses", proses);
  if (status) q = q.eq("status", status);
  if (gudang) q = q.or(`from_warehouse_id.eq.${gudang},to_warehouse_id.eq.${gudang}`);

  const [{ data }, { data: whs }] = await Promise.all([
    q,
    supabase.from("warehouses").select("id, name").eq("is_active", true).neq("type", "TRANSIT").order("name"),
  ]);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Pemindahan Barang</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success}
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader
          num="01"
          title="PEMINDAHAN BARANG"
          desc="Pindah stok antar gudang: Kirim → Transit → Terima (pola Accurate)."
          action={
            <Link href="/pos/pemindahan/baru" className="btn-acc" style={{ textDecoration: "none" }}>
              + Kirim barang
            </Link>
          }
        />

        <form method="get" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <select className="fi" name="proses" defaultValue={proses ?? ""} style={{ width: 160 }}>
            <option value="">Tipe Proses: Semua</option>
            <option value="Kirim Barang">Kirim Barang</option>
            <option value="Terima Barang">Terima Barang</option>
          </select>
          <select className="fi" name="status" defaultValue={status ?? ""} style={{ width: 190 }}>
            <option value="">Status Pengiriman: Semua</option>
            <option value="Sedang dikirim">Sedang dikirim</option>
            <option value="Diterima Sebagian">Diterima Sebagian</option>
            <option value="Diterima Seluruhnya">Diterima Seluruhnya</option>
            <option value="Dibatalkan">Dibatalkan</option>
          </select>
          <select className="fi" name="gudang" defaultValue={gudang ?? ""} style={{ width: 180 }}>
            <option value="">Gudang: Semua</option>
            {(whs ?? []).map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <button type="submit" className="btn-def" style={{ padding: "4px 12px", fontSize: 10.5 }}>
            <i className="ti ti-filter" /> Filter
          </button>
        </form>

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>Nomor #</th>
                <th>Tanggal</th>
                <th>Tipe Proses</th>
                <th>Gudang Asal</th>
                <th>Gudang Tujuan</th>
                <th style={{ textAlign: "center" }}>Item</th>
                <th>Keterangan</th>
                <th>Status Pengiriman</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500, fontSize: 11.5 }}>
                    <Link href={`/pos/pemindahan/${r.id}`} style={{ color: "var(--ac)" }}>
                      {r.no_pemindahan}
                    </Link>
                  </td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtD(r.tanggal)}</td>
                  <td style={{ fontSize: 11.5 }}>{r.proses}</td>
                  <td style={{ fontSize: 11.5 }}>{r.from?.name ?? "—"}</td>
                  <td style={{ fontSize: 11.5 }}>{r.to?.name ?? "—"}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{r.stock_transfer_items?.length ?? 0}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.keterangan ?? ""}</td>
                  <td>
                    {r.status ? (
                      <span className={`bge ${STATUS_BADGE[r.status] ?? "x"}`}>{r.status}</span>
                    ) : (
                      <span style={{ color: "var(--td)", fontSize: 11 }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    Belum ada pemindahan barang.
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
