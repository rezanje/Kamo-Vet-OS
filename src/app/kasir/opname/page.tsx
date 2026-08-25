import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { gudangCabang } from "./gudang";

// Stok Opname di dunia kasir: hitung fisik rak sendiri tanpa menutup toko.
// Sengaja tidak menampilkan harga apa pun — kasir cukup tahu jumlah.

type Order = {
  id: string;
  no_opname: string;
  tanggal_mulai: string;
  penanggung_jawab: string;
  status: string;
  opname_order_items: { item_id: string }[] | null;
};

const fmtD = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });

export default async function OpnameKasirPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const wh = await gudangCabang(supabase, shift.branch_id);

  const { data } = wh
    ? await supabase
        .from("opname_orders")
        .select("id, no_opname, tanggal_mulai, penanggung_jawab, status, opname_order_items(item_id)")
        .eq("warehouse_id", wh.id)
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: [] };

  const orders = (data ?? []) as unknown as Order[];

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: "var(--posb)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <i className="ti ti-clipboard-check" style={{ fontSize: 22, color: "#fff" }} />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--tx)", letterSpacing: ".01em" }}>STOK OPNAME</div>
            <div style={{ fontSize: 11.5, color: "var(--tm)" }}>
              Hitung fisik barang di {wh?.name ?? shift.branchName} · bisa sebagian rak saja
            </div>
          </div>
        </div>
        {wh && (
          <Link href="/kasir/opname/baru" className="btn-acc" style={{ textDecoration: "none", padding: "9px 16px", fontSize: 12.5, background: "var(--posb)" }}>
            + Hitung Stok
          </Link>
        )}
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      {!wh && (
        <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#b45309" }}>
          <i className="ti ti-alert-triangle" /> Cabang ini belum punya gudang aktif. Hubungi admin dulu.
        </div>
      )}

      <div className="crm-sec">
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>No. Opname</th>
                <th>Tanggal</th>
                <th>Penanggung jawab</th>
                <th>Lingkup</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const lingkup = o.opname_order_items?.length ?? 0;
                return (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/kasir/opname/${o.id}`} style={{ fontWeight: 700, fontSize: 11.5, color: "var(--posb)" }}>
                        {o.no_opname}
                      </Link>
                    </td>
                    <td style={{ fontSize: 11.5 }}>{fmtD(o.tanggal_mulai)}</td>
                    <td style={{ fontSize: 11.5 }}>{o.penanggung_jawab}</td>
                    <td style={{ fontSize: 11.5 }}>
                      {lingkup > 0
                        ? <><span className="bge o">Sebagian</span> {lingkup} barang</>
                        : <><span className="bge b">Penuh</span> seluruh gudang</>}
                    </td>
                    <td>
                      <span className={`bge ${o.status === "Selesai" ? "g" : "o"}`}>{o.status}</span>
                    </td>
                  </tr>
                );
              })}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "var(--td)", padding: "24px 0", fontSize: 11.5 }}>
                    Belum ada hitungan stok di cabang ini.
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
