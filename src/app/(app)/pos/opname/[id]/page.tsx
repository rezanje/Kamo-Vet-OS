import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { HasilView } from "./HasilView";

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

  const { count } = await supabase
    .from("opname_order_items").select("*", { count: "exact", head: true }).eq("order_id", id);
  const jumlahLingkup = count ?? 0;

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
        <SecHeader num="01" title="PERINTAH STOK OPNAME" desc={order.keterangan ?? (jumlahLingkup ? "Hitung fisik sebagian barang di gudang." : "Hitung fisik seluruh barang di gudang.")} />
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
            <div className="flab">Lingkup</div>
            <div style={{ fontSize: 12 }}>
              {jumlahLingkup > 0
                ? <><span className="bge o">Sebagian</span> {jumlahLingkup} barang</>
                : <><span className="bge b">Penuh</span> seluruh gudang</>}
            </div>
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

      {/* Menghitung stok hanya dari layar kasir (keputusan meeting 14 Agustus) —
          satu pintu, supaya tidak ada dua cara menghitung barang yang sama. */}
      {order.status === "Terbuka" ? (
        <div className="crm-sec">
          <SecHeader num="02" title="HITUNGAN BELUM MASUK" desc="Perintah ini masih menunggu hitungan fisik." />
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>
            Hitung fisik dikerjakan dari layar kasir cabang bersangkutan. Halaman ini hanya menampilkan
            hasil dan riwayatnya.
          </div>
        </div>
      ) : (
        <HasilView orderId={order.id} />
      )}
    </>
  );
}
