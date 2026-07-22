import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { HasilForm } from "./HasilForm";

type Order = {
  id: string;
  no_opname: string;
  tanggal_mulai: string;
  penanggung_jawab: string;
  dikerjakan_oleh: string | null;
  keterangan: string | null;
  status: string;
  warehouse_id: string;
  warehouses: { name: string } | null;
};

type ResultItem = {
  qty_sistem: number;
  qty_fisik: number;
  selisih: number;
  items: { code: string; name: string; unit: string } | null;
};

const fmtD = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

export default async function OpnameDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const { success, error } = await searchParams;
  const supabase = await createClient();

  const { data: orderRaw } = await supabase
    .from("opname_orders")
    .select("id, no_opname, tanggal_mulai, penanggung_jawab, dikerjakan_oleh, keterangan, status, warehouse_id, warehouses(name)")
    .eq("id", id).maybeSingle();
  if (!orderRaw) notFound();
  const order = orderRaw as unknown as Order;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos/opname" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{order.no_opname}</span>
        <span className={`bge ${order.status === "Selesai" ? "g" : "o"}`}>{order.status}</span>
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
        <SecHeader num="01" title="PERINTAH STOK OPNAME" desc={order.keterangan ?? "Hitung fisik seluruh barang di gudang."} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(140px, 1fr))", gap: 10 }}>
          <div>
            <div className="flab">Tanggal mulai</div>
            <div style={{ fontSize: 12 }}>{fmtD(order.tanggal_mulai)}</div>
          </div>
          <div>
            <div className="flab">Gudang</div>
            <div style={{ fontSize: 12 }}>{order.warehouses?.name ?? "—"}</div>
          </div>
          <div>
            <div className="flab">Penanggung jawab</div>
            <div style={{ fontSize: 12 }}>{order.penanggung_jawab}</div>
          </div>
          <div>
            <div className="flab">Dikerjakan oleh</div>
            <div style={{ fontSize: 12 }}>{order.dikerjakan_oleh ?? "—"}</div>
          </div>
        </div>
      </div>

      {order.status === "Terbuka" ? (
        <OpenForm orderId={order.id} warehouseId={order.warehouse_id} />
      ) : (
        <DoneView orderId={order.id} />
      )}
    </>
  );
}

// Terbuka: form input hitungan fisik dari stok gudang saat ini.
async function OpenForm({ orderId, warehouseId }: { orderId: string; warehouseId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stock")
    .select("item_id, qty, items(code, name, unit)")
    .eq("warehouse_id", warehouseId);

  const rows = ((data ?? []) as unknown as { item_id: string; qty: number; items: { code: string; name: string; unit: string } | null }[])
    .map((s) => ({
      item_id: s.item_id,
      code: s.items?.code ?? "—",
      name: s.items?.name ?? "—",
      unit: s.items?.unit ?? "",
      qty_sistem: Number(s.qty),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return <HasilForm orderId={orderId} rows={rows} />;
}

// Selesai: tampilkan hasil tersimpan.
async function DoneView({ orderId }: { orderId: string }) {
  const supabase = await createClient();
  const { data: result } = await supabase
    .from("opname_results")
    .select("no_hasil, tanggal, opname_result_items(qty_sistem, qty_fisik, selisih, items(code, name, unit))")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const items = ((result?.opname_result_items ?? []) as unknown as ResultItem[])
    .sort((a, b) => (a.items?.name ?? "").localeCompare(b.items?.name ?? ""));
  const beda = items.filter((r) => Number(r.selisih) !== 0);

  return (
    <div className="crm-sec">
      <SecHeader
        num="02"
        title={`HASIL ${result?.no_hasil ?? ""}`}
        desc={`${items.length} barang dihitung, ${beda.length} barang selisih. Stok sudah disesuaikan.`}
      />
      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Kode #</th>
              <th>Nama Barang</th>
              <th style={{ textAlign: "right" }}>Sistem</th>
              <th style={{ textAlign: "right" }}>Fisik</th>
              <th style={{ textAlign: "right" }}>Selisih</th>
              <th>Satuan</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => (
              <tr key={i} style={Number(r.selisih) !== 0 ? { background: "#fffbeb" } : undefined}>
                <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.items?.code ?? "—"}</td>
                <td style={{ fontSize: 11.5 }}>{r.items?.name ?? "—"}</td>
                <td style={{ textAlign: "right", fontSize: 11.5 }}>{Number(r.qty_sistem)}</td>
                <td style={{ textAlign: "right", fontSize: 11.5 }}>{Number(r.qty_fisik)}</td>
                <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: Number(r.selisih) === 0 ? "var(--tm)" : Number(r.selisih) > 0 ? "#15803d" : "#b91c1c" }}>
                  {Number(r.selisih) > 0 ? "+" : ""}{Number(r.selisih)}
                </td>
                <td style={{ fontSize: 11 }}>{r.items?.unit ?? ""}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Tidak ada rincian hasil.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
