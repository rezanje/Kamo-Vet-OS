import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { DokumenPanel } from "@/components/dokumen/DokumenPanel";
import { POEditForm, POCancelForm } from "./POCorrectionForm";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtTgl = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric" });

const BADGE: Record<string, string> = { Draft: "x", Dikirim: "b", Dipesan: "b", Diterima: "g", Batal: "r" };

type PO = {
  id: string;
  no_po: string | null;
  tanggal: string;
  status: string;
  total: number;
  revision: number;
  supplier_id: string | null;
  to_warehouse_id: string;
  suppliers: Rel<{ nama: string }>;
  warehouses: Rel<{ name: string }>;
  branches: Rel<{ name: string }>;
  purchase_order_items: {
    id: string; item_id: string | null; nama: string; qty: number; satuan: string | null; faktor: number;
    qty_terima: number | null; harga_beli: number;
  }[] | null;
};

export default async function PODetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const { success, error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data } = await supabase.from("purchase_orders").select("id, no_po, tanggal, status, total, revision, supplier_id, to_warehouse_id, branch_id, suppliers(nama), warehouses(name), branches(name), purchase_order_items(id, item_id, nama, qty, satuan, faktor, qty_terima, harga_beli)").eq("id", id).maybeSingle();
  const po = data as unknown as (PO & { branch_id: string }) | null;
  if (!po) notFound();

  const [{ data: suppliers }, { data: warehouses }] = await Promise.all([
    supabase.from("suppliers").select("id, nama").order("nama"),
    supabase.from("warehouses").select("id, name, branch_id").eq("branch_id", po.branch_id).eq("is_active", true).order("name"),
  ]);

  const items = po.purchase_order_items ?? [];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 11, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/pembelian" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
          <span style={{ color: "var(--td)" }}>·</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{po.no_po ?? "Purchase Order"}</span>
        </div>
        {po.status !== "Diterima" && po.status !== "Batal" && (
          <Link href={`/pembelian/${po.id}/terima`} className="btn-acc" style={{ textDecoration: "none" }}>
            <i className="ti ti-package-import" /> Terima barang
          </Link>
        )}
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Dokumen tersimpan.
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
            <div style={{ fontSize: 17, fontWeight: 800 }}>{po.no_po ?? "—"}</div>
            <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>{fmtTgl(po.tanggal)}</div>
          </div>
          <span className={`bge ${BADGE[po.status] ?? "x"}`} style={{ fontSize: 11, padding: "4px 12px" }}>{po.status}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Info label="Supplier" value={one(po.suppliers)?.nama ?? "—"} />
          <Info label="Gudang tujuan" value={one(po.warehouses)?.name ?? "—"} />
          <Info label="Cabang" value={one(po.branches)?.name ?? "—"} />
          <Info label="Total PO" value={rp(Number(po.total))} />
        </div>
      </div>

      <div className="crm-sec">
        <SecHeader num="01" title="DAFTAR ITEM" desc="Barang, satuan, jumlah dipesan & diterima." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 660 }}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>No.</th>
                <th>Nama Barang</th>
                <th>Satuan</th>
                <th style={{ textAlign: "center" }}>Qty PO</th>
                <th style={{ textAlign: "center" }}>Qty Diterima</th>
                <th style={{ textAlign: "right" }}>Harga</th>
                <th style={{ textAlign: "right" }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 500 }}>{it.nama}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{it.satuan ?? "—"}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{Number(it.qty)}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{it.qty_terima != null ? Number(it.qty_terima) : "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(it.harga_beli))}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(it.qty) * Number(it.harga_beli))}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>Tidak ada item.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {user && (po.status === "Draft" || po.status === "Dipesan") && (
        <div className="crm-sec">
          <SecHeader num="02" title="KOREKSI PO" desc="Hanya Super Admin yang dapat mengubah atau membatalkan PO sebelum ada transaksi turunan." />
          <POEditForm userId={user.id} poId={po.id} revision={po.revision} supplierId={po.supplier_id ?? ""} warehouseId={po.to_warehouse_id} tanggal={po.tanggal} rows={items} suppliers={(suppliers ?? []) as { id: string; nama: string }[]} warehouses={(warehouses ?? []) as { id: string; name: string }[]} />
          <div style={{ borderTop: ".5px solid var(--bd)", marginTop: 14, paddingTop: 12 }}>
            <POCancelForm userId={user.id} poId={po.id} revision={po.revision} />
          </div>
        </div>
      )}

      <DokumenPanel modul="pembelian" refId={po.id} kembali={`/pembelian/${po.id}`} />
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
