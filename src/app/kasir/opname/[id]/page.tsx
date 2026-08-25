import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { SecHeader } from "@/components/SecHeader";
import { HasilView } from "@/app/(app)/pos/opname/[id]/HasilView";
import { DaftarHitung } from "./DaftarHitung";
import { gudangCabang } from "../gudang";

type Order = {
  id: string;
  no_opname: string;
  tanggal_mulai: string;
  penanggung_jawab: string;
  keterangan: string | null;
  status: string;
  warehouse_id: string;
};

const fmtD = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric" });

// Kasir hanya boleh membuka opname gudang cabangnya sendiri. Layar ini menutup
// pintunya; `simpanHasil` mengecek ulang di server sebelum stok disentuh.
export default async function OpnameKasirDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const { success, error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const { data: orderRaw } = await supabase
    .from("opname_orders")
    .select("id, no_opname, tanggal_mulai, penanggung_jawab, keterangan, status, warehouse_id")
    .eq("id", id).maybeSingle();
  const order = orderRaw as unknown as Order | null;

  const wh = await gudangCabang(supabase, shift.branch_id);
  if (!order || !wh || order.warehouse_id !== wh.id) {
    redirect("/kasir/opname?error=" + encodeURIComponent("Hitungan stok itu bukan milik cabang ini."));
  }

  const { count } = await supabase
    .from("opname_order_items").select("*", { count: "exact", head: true }).eq("order_id", id);
  const jumlahLingkup = count ?? 0;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <Link href="/kasir/opname" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{order!.no_opname}</span>
        <span className={`bge ${order!.status === "Selesai" ? "g" : "o"}`}>{order!.status}</span>
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
          title="HITUNG STOK"
          desc={order!.keterangan ?? (jumlahLingkup ? "Hitung fisik sebagian rak." : "Hitung fisik seluruh gudang cabang.")}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <div>
            <div className="flab">Tanggal</div>
            <div style={{ fontSize: 12 }}>{fmtD(order!.tanggal_mulai)}</div>
          </div>
          <div>
            <div className="flab">Gudang</div>
            <div style={{ fontSize: 12 }}>{wh!.name}</div>
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
            <div style={{ fontSize: 12 }}>{order!.penanggung_jawab}</div>
          </div>
        </div>
      </div>

      {order!.status === "Terbuka" ? (
        <DaftarHitung orderId={order!.id} warehouseId={order!.warehouse_id} />
      ) : (
        <HasilView orderId={order!.id} />
      )}
    </>
  );
}
