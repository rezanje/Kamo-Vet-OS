import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Dok = {
  id: string;
  no_terima: string;
  tanggal: string;
  surat_jalan: string | null;
  purchase_orders: Rel<{ no_po: string | null; suppliers: Rel<{ nama: string }> }>;
  goods_receipt_items: { qty_terima: number; qty_rusak: number; harga: number }[] | null;
};

export default async function PenerimaanPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("goods_receipts")
    .select("id, no_terima, tanggal, surat_jalan, purchase_orders(no_po, suppliers(nama)), goods_receipt_items(qty_terima, qty_rusak, harga)")
    .order("tanggal", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  const dok = (data ?? []) as unknown as Dok[];

  const nilai = (d: Dok) => (d.goods_receipt_items ?? []).reduce((a, i) => a + Number(i.qty_terima) * Number(i.harga), 0);
  const rusak = (d: Dok) => (d.goods_receipt_items ?? []).reduce((a, i) => a + Number(i.qty_rusak), 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pembelian" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Penerimaan Barang</span>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader
          num="01" title="DOKUMEN PENERIMAAN"
          desc="Satu dokumen per kiriman. Kiriman bertahap dari satu PO tercatat terpisah."
        />

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ width: 160 }}>No. dokumen</th>
                <th style={{ width: 110 }}>Tanggal</th>
                <th>Pemasok</th>
                <th style={{ width: 130 }}>PO</th>
                <th style={{ width: 130 }}>Surat jalan</th>
                <th style={{ width: 90 }}>Rusak</th>
                <th style={{ width: 140, textAlign: "right" }}>Nilai diterima</th>
              </tr>
            </thead>
            <tbody>
              {dok.map((d) => {
                const po = one(d.purchase_orders);
                const rsk = rusak(d);
                return (
                  <tr key={d.id}>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                      <Link href={`/pembelian/penerimaan/${d.id}`} style={{ color: "#2563eb", textDecoration: "none" }}>
                        {d.no_terima}
                      </Link>
                    </td>
                    <td style={{ fontSize: 11 }}>{tgl(d.tanggal)}</td>
                    <td style={{ fontSize: 11.5 }}>{one(po?.suppliers ?? null)?.nama ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{po?.no_po ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{d.surat_jalan ?? "—"}</td>
                    <td style={{ fontSize: 10.5 }}>
                      {rsk > 0 ? <span className="bge r">{rsk} unit</span> : <span style={{ color: "var(--td)" }}>—</span>}
                    </td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(nilai(d))}</td>
                  </tr>
                );
              })}
              {dok.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada penerimaan barang. Dokumen dibuat otomatis saat kamu menerima barang dari layar PO.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
