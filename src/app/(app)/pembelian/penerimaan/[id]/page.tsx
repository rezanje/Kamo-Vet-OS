import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/PrintButton";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric" });

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Baris = {
  id: string; nama: string; satuan: string | null;
  qty_pesan: number; qty_sisa_sebelum: number; qty_terima: number; qty_rusak: number;
  harga: number; catatan: string | null;
};

export default async function DetailPenerimaanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("goods_receipts")
    .select("id, no_terima, tanggal, surat_jalan, catatan, purchase_orders(no_po, branches(name), warehouses(name), suppliers(nama)), profiles(full_name), goods_receipt_items(id, nama, satuan, qty_pesan, qty_sisa_sebelum, qty_terima, qty_rusak, harga, catatan)")
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  const po = one(data.purchase_orders as Rel<{ no_po: string | null; branches: Rel<{ name: string }>; warehouses: Rel<{ name: string }>; suppliers: Rel<{ nama: string }> }>);
  const baris = (data.goods_receipt_items ?? []) as Baris[];
  const penerima = one(data.profiles as Rel<{ full_name: string | null }>)?.full_name ?? "—";

  const nilai = baris.reduce((a, b) => a + Number(b.qty_terima) * Number(b.harga), 0);
  const totalRusak = baris.reduce((a, b) => a + Number(b.qty_rusak), 0);

  return (
    <>
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pembelian/penerimaan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{data.no_terima}</span>
        <span style={{ marginLeft: "auto" }}><PrintButton label="Cetak tanda terima" /></span>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--sb)" }}>TANDA TERIMA BARANG</div>
        <div style={{ fontSize: 11, color: "var(--tm)", marginBottom: 12 }}>{data.no_terima} · {tgl(data.tanggal)}</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 18px", fontSize: 11, marginBottom: 14 }}>
          <KV k="Pemasok" v={one(po?.suppliers ?? null)?.nama ?? "—"} />
          <KV k="No. PO" v={po?.no_po ?? "—"} />
          <KV k="Gudang" v={one(po?.warehouses ?? null)?.name ?? "—"} />
          <KV k="Cabang" v={one(po?.branches ?? null)?.name ?? "—"} />
          <KV k="Surat jalan" v={data.surat_jalan ?? "—"} />
          <KV k="Diterima oleh" v={penerima} />
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Barang</th>
                <th style={{ width: 80, textAlign: "right" }}>Dipesan</th>
                <th style={{ width: 90, textAlign: "right" }}>Sisa sebelum</th>
                <th style={{ width: 90, textAlign: "right" }}>Diterima</th>
                <th style={{ width: 80, textAlign: "right" }}>Rusak</th>
                <th style={{ width: 110, textAlign: "right" }}>Harga</th>
                <th style={{ width: 120, textAlign: "right" }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {baris.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontSize: 11.5 }}>
                    {b.nama}
                    {b.catatan && <div style={{ fontSize: 9.5, color: "var(--td)" }}>{b.catatan}</div>}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{Number(b.qty_pesan)} {b.satuan ?? ""}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>{Number(b.qty_sisa_sebelum)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{Number(b.qty_terima)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: Number(b.qty_rusak) > 0 ? "#b91c1c" : "var(--td)" }}>
                    {Number(b.qty_rusak) || "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(Number(b.harga))}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(b.qty_terima) * Number(b.harga))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>Nilai barang diterima</td>
                <td style={{ textAlign: "right", fontSize: 13, fontWeight: 800 }}>{rp(nilai)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {totalRusak > 0 && (
          <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e", marginTop: 10 }}>
            <i className="ti ti-alert-triangle" /> {totalRusak} unit datang rusak dan ditolak — tidak masuk stok,
            tidak menambah hutang, dan sisa pesanannya tetap ditagih ke pemasok.
          </div>
        )}

        {data.catatan && (
          <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 10 }}>Catatan: {data.catatan}</div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, marginTop: 34, fontSize: 10.5 }}>
          <div>
            <div style={{ color: "var(--tm)" }}>Pengirim / pemasok</div>
            <div style={{ borderTop: ".5px solid #141413", marginTop: 40, paddingTop: 3 }}>( ____________________ )</div>
          </div>
          <div>
            <div style={{ color: "var(--tm)" }}>Penerima</div>
            <div style={{ borderTop: ".5px solid #141413", marginTop: 40, paddingTop: 3 }}>( {penerima} )</div>
          </div>
        </div>
      </div>
    </>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <span style={{ color: "var(--tm)", minWidth: 96 }}>{k}</span>
      <span style={{ fontWeight: 600 }}>{v}</span>
    </div>
  );
}
