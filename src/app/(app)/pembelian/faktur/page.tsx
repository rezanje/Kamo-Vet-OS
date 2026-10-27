import { PurchaseRecoveryComplete } from "@/components/PurchaseRequestKey";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { ListLoadFailure, ListPagination } from "@/components/ListPagination";
import { readCompleteList, readListPage } from "@/lib/checked-list";
import { hariIniWIB } from "@/lib/tanggal";

type Rel<T> = T | T[] | null;
const one = <T,>(value: Rel<T>): T | null => Array.isArray(value) ? (value[0] ?? null) : value;

type Row = {
  id: string;
  no_faktur: string;
  voided_at: string | null;
  no_faktur_pemasok: string | null;
  surat_jalan: string | null;
  tanggal: string;
  jatuh_tempo: string;
  total: number;
  suppliers: Rel<{ nama: string }>;
  purchase_orders: Rel<{ no_po: string | null }>;
  opening_batch_id: string | null;
};

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const fmtD = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });

export default async function FakturBeliPage({
  searchParams,
}: {
  searchParams: Promise<{ request_done?: string; request_scope?: string; success?: string; error?: string; hal?: string }>;
}) {
  const { request_done, request_scope, success, error, hal } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? "";

  let invoicePage: Awaited<ReturnType<typeof readListPage<Row>>> | undefined;
  let loadError: unknown;
  const paidByInvoice = new Map<string, number>();
  try {
    invoicePage = await readListPage<Row>((from, to) => supabase.from("purchase_invoices")
      .select("id, voided_at, no_faktur, no_faktur_pemasok, surat_jalan, tanggal, jatuh_tempo, total, opening_batch_id, suppliers(nama), purchase_orders(no_po)", { count: "exact" })
      .order("created_at", { ascending: false }).order("id").range(from, to), "Daftar faktur pembelian", hal);
    const ids = invoicePage.rows.map(row => row.id);
    if (ids.length) {
      const payments = await readCompleteList<{ id: string; invoice_id: string; amount: number }>((from, to) => supabase
        .from("purchase_invoice_payments").select("id, invoice_id, amount", { count: "exact" })
        .in("invoice_id", ids).order("id").range(from, to), "Pembayaran faktur pembelian", { maxRows: null });
      for (const payment of payments) paidByInvoice.set(payment.invoice_id, (paidByInvoice.get(payment.invoice_id) ?? 0) + Number(payment.amount));
    }
  } catch (cause) { loadError = cause; }
  const rows = loadError ? [] : invoicePage?.rows ?? [];
  const today = hariIniWIB();

  return (
    <>
      <PurchaseRecoveryComplete userId={userId} scope={request_scope} requestKey={request_done} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pembelian" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Faktur Pembelian</span>
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
          title="FAKTUR PEMBELIAN"
          desc="Tagihan resmi pemasok — hutang usaha lahir dari sini, dibayar per faktur (pola Accurate)."
          action={
            <Link href="/pembelian/faktur/baru" className="btn-acc" style={{ textDecoration: "none" }}>
              + Buat faktur
            </Link>
          }
        />
        {loadError !== undefined && <ListLoadFailure error={loadError} label="Daftar faktur pembelian" />}
        {!loadError && <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 880 }}>
            <thead>
              <tr>
                <th>Nomor #</th>
                <th>No. Faktur Pemasok</th>
                <th>Tanggal</th>
                <th>Jatuh Tempo</th>
                <th>Pemasok</th>
                <th>PO</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "right" }}>Sisa</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dibayar = paidByInvoice.get(r.id) ?? 0;
                const sisa = r.voided_at ? 0 : Math.max(0, Number(r.total) - dibayar);
                const telat = sisa > 0 && r.jatuh_tempo < today;
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 500, fontSize: 11.5 }}><Link href={`/pembelian/faktur/${r.id}`}>{r.no_faktur}</Link>{r.voided_at && <span> · Dibatalkan</span>}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>
                      {r.no_faktur_pemasok ?? "—"}
                      {r.surat_jalan && <div style={{ fontSize: 9.5, color: "var(--td)" }}>SJ {r.surat_jalan}</div>}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtD(r.tanggal)}</td>
                    <td style={{ fontSize: 11, color: telat ? "#b91c1c" : "var(--tm)", fontWeight: telat ? 700 : 400 }}>
                      {fmtD(r.jatuh_tempo)}{telat ? " !" : ""}
                    </td>
                    <td style={{ fontSize: 11.5 }}>{one(r.suppliers)?.nama ?? "—"}</td>
                    <td style={{ fontSize: 11.5 }}>{r.opening_batch_id ? <span className="bge b">Saldo awal</span> : one(r.purchase_orders)?.no_po ?? "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(r.total))}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: sisa > 0 ? "#b91c1c" : "#15803d" }}>
                      {sisa > 0 ? rp(sisa) : "Lunas"}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    Belum ada faktur pembelian.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>}
        {invoicePage && !loadError && <ListPagination path="/pembelian/faktur" query={{ request_done: request_done ?? "", request_scope: request_scope ?? "" }} total={invoicePage.count} pageInfo={invoicePage.pageInfo} />}
      </div>
    </>
  );
}
