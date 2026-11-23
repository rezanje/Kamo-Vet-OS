import { readListPage } from "@/lib/checked-list";
import { ListLoadFailure, ListPagination } from "@/components/ListPagination";
import { SecHeader } from "@/components/SecHeader";
import { INVOP_PATH, fmtQty, fmtSelisih, isUuid } from "@/lib/inventaris-operasional";
import { loadInvopContext } from "@/lib/inventaris-operasional-server";
import { InvopHeader, TanpaCabang } from "../InvopHeader";

type Row = {
  id: string; jenis: "saldo_awal" | "opname"; count_id: string | null;
  qty_sebelum: number; qty_sesudah: number; selisih: number; alasan: string | null; actor_nama: string; created_at: string;
  operational_inventory_items: { nama: string; satuan: string } | null;
};

const fmtWaktu = (v: string) => new Date(v).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function RiwayatOperasionalPage({ searchParams }: {
  searchParams: Promise<{ cabang?: string; success?: string; opname?: string; hal?: string }>;
}) {
  const { cabang, success, opname, hal } = await searchParams;
  const opnameId = isUuid(opname) ? opname : null;
  let ctx, page;
  try {
    ctx = await loadInvopContext(cabang);
    const { supabase, branch } = ctx;
    page = branch ? await readListPage<Row>(async (from, to) => {
      let query = supabase.from("operational_inventory_history")
        .select("id,jenis,count_id,qty_sebelum,qty_sesudah,selisih,alasan,actor_nama,created_at,operational_inventory_items(nama,satuan)", { count: "exact" })
        .eq("branch_id", branch.id);
      if (opnameId) query = query.eq("count_id", opnameId);
      const response = await query.order("created_at", { ascending: false }).order("id").range(from, to);
      return { ...response, data: response.data as unknown as Row[] | null };
    }, "Riwayat inventaris operasional", hal) : null;
  } catch (loadError) {
    return <ListLoadFailure error={loadError} label="Riwayat inventaris operasional" />;
  }
  const { branches, branch } = ctx;

  return (
    <>
      <InvopHeader active="riwayat" branches={branches} branch={branch} success={success} />
      {!branch || !page ? <TanpaCabang /> : (
        <div className="crm-sec">
          <SecHeader num="01" title={`RIWAYAT · ${branch.name.toUpperCase()}`}
            desc={opnameId ? "Menampilkan satu opname. Buka Riwayat Cabang untuk semua perubahan." : "Semua perubahan jumlah: saldo awal dan opname, dengan petugas, waktu, dan alasannya."} />
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 900 }}>
              <thead>
                <tr><th>Waktu</th><th>Barang</th><th>Jenis</th><th style={{ textAlign: "right" }}>Sebelum</th><th style={{ textAlign: "right" }}>Sesudah</th>
                  <th style={{ textAlign: "right" }}>Selisih</th><th>Alasan</th><th>Petugas</th></tr>
              </thead>
              <tbody>
                {page.rows.map(r => {
                  const d = Number(r.selisih);
                  return (
                    <tr key={r.id}>
                      <td style={{ fontSize: 11, color: "var(--tm)", whiteSpace: "nowrap" }}>{fmtWaktu(r.created_at)}</td>
                      <td style={{ fontSize: 11.5, fontWeight: 500 }}>{r.operational_inventory_items?.nama ?? "—"} <span style={{ color: "var(--td)", fontWeight: 400 }}>{r.operational_inventory_items?.satuan}</span></td>
                      <td><span className={`bge ${r.jenis === "opname" ? "o" : "g"}`}>{r.jenis === "opname" ? "Opname" : "Saldo awal"}</span></td>
                      <td style={{ textAlign: "right", fontSize: 11.5 }}>{fmtQty(Number(r.qty_sebelum))}</td>
                      <td style={{ textAlign: "right", fontSize: 11.5 }}>{fmtQty(Number(r.qty_sesudah))}</td>
                      <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: r.jenis === "opname" && d !== 0 ? "#b91c1c" : "var(--tm)" }}>
                        {r.jenis === "opname" ? (d === 0 ? "Sesuai" : fmtSelisih(d)) : "—"}
                      </td>
                      <td style={{ fontSize: 11 }}>{r.alasan ?? ""}</td>
                      <td style={{ fontSize: 11 }}>{r.actor_nama}</td>
                    </tr>
                  );
                })}
                {page.rows.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>Belum ada riwayat.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <ListPagination path={`${INVOP_PATH}/riwayat`} query={{ cabang: branch.id, opname: opnameId ?? "" }} total={page.count} pageInfo={page.pageInfo} />
        </div>
      )}
    </>
  );
}
