import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { ListLoadFailure, ListPagination } from "@/components/ListPagination";
import { readCompleteList, readListPage } from "@/lib/checked-list";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Dok = {
  id: string;
  no_terima: string;
  tanggal: string;
  surat_jalan: string | null;
  voided_at: string | null;
  purchase_orders: Rel<{ no_po: string | null; suppliers: Rel<{ nama: string }> }>;
};

export default async function PenerimaanPage({ searchParams }: { searchParams: Promise<{ hal?: string }> }) {
  const { hal } = await searchParams;
  const supabase = await createClient();
  let receiptPage: Awaited<ReturnType<typeof readListPage<Dok>>> | undefined;
  let loadError: unknown;
  const totals = new Map<string, { nilai: number; rusak: number }>();
  try {
    receiptPage = await readListPage<Dok>((from, to) => supabase.from("goods_receipts")
      .select("id, no_terima, tanggal, surat_jalan, voided_at, purchase_orders(no_po, suppliers(nama))", { count: "exact" })
      .order("tanggal", { ascending: false }).order("created_at", { ascending: false }).order("id")
      .range(from, to), "Daftar penerimaan barang", hal);
    const ids = receiptPage.rows.map(receipt => receipt.id);
    if (ids.length) {
      const items = await readCompleteList<{ id: string; receipt_id: string; qty_terima: number; qty_rusak: number; harga: number }>((from, to) => supabase
        .from("goods_receipt_items").select("id, receipt_id, qty_terima, qty_rusak, harga", { count: "exact" })
        .in("receipt_id", ids).order("id").range(from, to), "Baris penerimaan barang", { maxRows: null });
      for (const item of items) {
        const current = totals.get(item.receipt_id) ?? { nilai: 0, rusak: 0 };
        current.nilai += Number(item.qty_terima) * Number(item.harga);
        current.rusak += Number(item.qty_rusak);
        totals.set(item.receipt_id, current);
      }
    }
  } catch (cause) { loadError = cause; }
  const dok = loadError === undefined ? receiptPage?.rows ?? [] : [];

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

        {loadError !== undefined && <ListLoadFailure error={loadError} label="Daftar penerimaan barang" />}
        {loadError === undefined && <div style={{ overflowX: "auto" }}>
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
                <th style={{ width: 80 }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {dok.map((d) => {
                const po = one(d.purchase_orders);
                const summary = totals.get(d.id) ?? { nilai: 0, rusak: 0 };
                const rsk = summary.rusak;
                return (
                  <tr key={d.id}>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                      <Link href={`/pembelian/penerimaan/${d.id}`} style={{ color: "#2563eb", textDecoration: "none" }}>
                        {d.no_terima}
                      </Link>
                      {d.voided_at && <span className="bge r" style={{ marginLeft: 6 }}>Dibatalkan</span>}
                    </td>
                    <td style={{ fontSize: 11 }}>{tgl(d.tanggal)}</td>
                    <td style={{ fontSize: 11.5 }}>{one(po?.suppliers ?? null)?.nama ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{po?.no_po ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{d.surat_jalan ?? "—"}</td>
                    <td style={{ fontSize: 10.5 }}>
                      {rsk > 0 ? <span className="bge r">{rsk} unit</span> : <span style={{ color: "var(--td)" }}>—</span>}
                    </td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, textDecoration: d.voided_at ? "line-through" : undefined }}>{rp(summary.nilai)}</td>
                    <td><Link href={`/pembelian/penerimaan/${d.id}`} className="btn-def" style={{ textDecoration: "none", padding: "4px 10px", fontSize: 10.5 }}>{d.voided_at ? "Lihat" : <><i className="ti ti-pencil" /> Edit</>}</Link></td>
                  </tr>
                );
              })}
              {dok.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada penerimaan barang. Dokumen dibuat otomatis saat kamu menerima barang dari layar PO.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>}
        {receiptPage && loadError === undefined && <ListPagination path="/pembelian/penerimaan" query={{}} total={receiptPage.count} pageInfo={receiptPage.pageInfo} />}
      </div>
    </>
  );
}
