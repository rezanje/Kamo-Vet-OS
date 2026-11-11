import { formatPosMoney } from "@/lib/pos-money";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { DokumenPanel } from "@/components/dokumen/DokumenPanel";
import { saleMerchandiseTotal, salePaymentAllocations, type SalePaymentSource } from "@/lib/sale-payment-reporting";
import { TransactionHistoryPanel } from "@/components/TransactionHistoryPanel";
import { bolehLihatRiwayat, petshopHistory, type PetshopOnlineCancel, type PetshopReceiptCancel } from "@/lib/transaction-history";
import { loadActorNames } from "@/lib/transaction-history-server";

import { SaleCancelForm } from "./SaleCancelForm";
import { SalePaymentCorrectionForm } from "./SalePaymentCorrectionForm";
import { OnlineDisbursementCancelForm, SaleReceiptCancelForm, SaleReceiveAgainForm } from "./SaleReceiptForms";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const rp = formatPosMoney;
const fmtDt = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

type Sale = SalePaymentSource & {
  id: string; revision: number; channel: string | null; void_reason: string | null;
  branch_id: string; shift_id: string | null; marketplace_status: string | null;
  no_struk: string | null;
  created_at: string;
  subtotal: number;
  discount: number;
  total: number;
  metode_bayar: string;
  bayar: number;
  kembali: number;
  branches: Rel<{ name: string }>;
  customers: Rel<{ name: string; phone: string | null }>;
  kasir: Rel<{ full_name: string | null }>;
  sale_items: { id: string; nama: string; qty: number; harga: number; satuan: string | null }[] | null;
};

type ReturRow = {
  id: string; no_retur: string | null; tanggal: string; total: number; voided_at: string | null;
  sales_return_items: { id: string; nama: string; qty: number }[] | null;
};
type PaymentCorrection = { id: string; revision: number; reason: string; created_at: string; created_by: string | null;
  before_payments: { method: string; amount: number }[]; after_payments: { method: string; amount: number }[] };

export default async function PenjualanDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string; shift?: string }>;
}) {
  const { id } = await params;
  const { success, error, shift: shiftParam } = await searchParams;
  const shiftLain = shiftParam === "lain";
  const supabase = await createClient();

  const { data } = await supabase
    .from("sales")
    .select("id, revision, channel, void_reason, branch_id, shift_id, marketplace_status, no_struk, created_at, subtotal, discount, total, merchant_fee_total, metode_bayar, bayar, kembali, payment_plan, payments_finalized_at, voided_at, sale_payments(method, amount, fee_percent, fee_amount), branches(name), customers(name, phone), kasir:cashier_id(full_name), sale_items(id, nama, qty, harga, satuan)")
    .eq("id", id)
    .maybeSingle();

  const sale = data as unknown as Sale | null;
  if (!sale) notFound();
  const payments = salePaymentAllocations(sale);
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user ? await supabase.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle() : { data: null };
  const isOwner = profile?.role === "OWNER" && profile.is_active === true;
  // J02: koreksi metode (juga sesudah shift ditutup) boleh Owner dan Finance; pembatalan tetap Owner.
  const canCorrectRole = isOwner || (profile?.role === "FINANCE" && profile.is_active === true);

  // Batalkan penerimaan: catatan struk ini, status shift asal, dan hak peran (Owner tidak pernah terkunci).
  const { data: receiptData, error: receiptError } = await supabase.from("pos_receipt_cancellations")
    .select("id, reason, created_at, created_by, source_shift_status, source_shift_id, effect_shift_id, before_payments, after_payments, closed_at, closed_by, closed_kind")
    .eq("sale_id", id).order("created_at", { ascending: true });
  const receiptCancels = (receiptData ?? []) as unknown as PetshopReceiptCancel[];
  const openCancel = receiptCancels.find(c => !c.closed_at) ?? null;
  const { data: onlineData, error: onlineError } = sale.channel
    ? await supabase.from("online_disbursement_cancellations").select("id, reason, created_at, created_by, amount_bank, amount_fee").eq("sale_id", id).order("created_at", { ascending: true })
    : { data: null, error: null };
  const onlineCancels = (onlineData ?? []) as unknown as PetshopOnlineCancel[];
  const { data: shiftRow } = sale.shift_id ? await supabase.from("cashier_shifts").select("status").eq("id", sale.shift_id).maybeSingle() : { data: null };
  const shiftClosed = !!sale.shift_id && shiftRow?.status === "closed";
  let canCancelReceipt = false;
  if (user && profile?.is_active === true) {
    const { data: allowed, error: allowedError } = await supabase.rpc("pos_receipt_actor_allowed", { p_branch: sale.branch_id });
    // Owner: kalau pembacaan hak gagal, layar tetap menampilkan tombolnya; database yang memutuskan (Owner selalu lolos di sana).
    canCancelReceipt = allowed === true || (!!allowedError && isOwner);
  }
  const hasReceiptCycle = receiptCancels.length > 0;

  const { data: returData } = await supabase
    .from("sales_returns")
    .select("id, no_retur, tanggal, total, voided_at, sales_return_items(id, nama, qty)")
    .eq("sale_id", id)
    .order("tanggal", { ascending: false });
  const returs = (returData ?? []) as unknown as ReturRow[];
  const { data: correctionData, error: correctionError } = canCorrectRole
    ? await supabase.from("sale_payment_corrections")
      .select("id, revision, reason, created_at, created_by, before_payments, after_payments")
      .eq("sale_id", id).order("revision", { ascending: false })
    : { data: null, error: null };
  const corrections = (correctionData ?? []) as PaymentCorrection[];
  // Riwayat perubahan terpadu (hanya baca). Tiap sumber dibaca lewat RLS-nya sendiri; ADMIN tidak punya hak baca koreksi metode.
  const tampilRiwayat = profile?.is_active === true && bolehLihatRiwayat(profile);
  const { data: cancellationData, error: cancellationError } = tampilRiwayat && sale.voided_at
    ? await supabase.from("sale_cancellations").select("id, reason, created_at, created_by").eq("sale_id", id).maybeSingle()
    : { data: null, error: null };
  const actors = tampilRiwayat
    ? await loadActorNames(supabase, [...corrections.map(c => c.created_by), cancellationData?.created_by, ...receiptCancels.flatMap(c => [c.created_by, c.closed_by]), ...onlineCancels.map(c => c.created_by)])
    : { names: new Map<string, string>(), error: false };
  const riwayat = tampilRiwayat ? petshopHistory({
    viewerId: user?.id ?? null, names: actors.names, corrections,
    cancellation: (cancellationData as { id: string; reason: string; created_at: string; created_by: string | null } | null) ?? null,
    returns: returs, receiptCancellations: receiptCancels, onlineCancellations: onlineCancels,
  }) : [];
  const cash = payments.find(part => part.method === "Tunai")?.amount ?? 0;
  const transfer = payments.find(part => part.method === "Transfer")?.amount ?? 0;
  const canCorrectPayment = canCorrectRole && !!user && !sale.voided_at && !sale.channel && !!sale.payment_plan && !openCancel && !hasReceiptCycle
    && !!sale.payments_finalized_at && cash + transfer > 0
    && returs.length === 0 && !sale.sale_payments?.some(part => ["Tunai", "Transfer"].includes(part.method)
      && (Number(part.fee_amount) !== 0 || Number(part.fee_percent) !== 0));

  const items = sale.sale_items ?? [];
  const cust = one(sale.customers);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 11, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/penjualan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
          <span style={{ color: "var(--td)" }}>·</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{sale.no_struk ?? "Penjualan"}</span>
        </div>
        {!sale.voided_at && <Link href={`/penjualan/retur/baru?struk=${encodeURIComponent(sale.no_struk ?? "")}`} className="btn-def" style={{ textDecoration: "none" }}>
          <i className="ti ti-arrow-back-up" /> Buat retur
        </Link>}
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success === "cancelled" ? "Penjualan dibatalkan. Riwayat dan pembalikannya tersimpan."
            : success === "payment-corrected" ? "Metode pembayaran terkoreksi pada penjualan ini. Jurnal pembalik dan pengganti tersimpan."
            : success === "receipt-cancelled" ? `Penerimaan dibatalkan: uang dikeluarkan dari kas/bank dan struk menjadi belum dibayar.${shiftLain ? " Shift asal struk sudah ditutup; angka tutupnya tidak diubah, pengembalian dicatat di shift terbuka cabang ini." : ""} Terima pembayaran lagi atau ubah transaksi di bawah.`
            : success === "receipt-received" ? "Pembayaran diterima ulang. Jurnal dan laci shift tercatat."
            : success === "disbursement-cancelled" ? "Pencairan dibatalkan: order kembali menjadi piutang marketplace." : "Dokumen tersimpan."}
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      {sale.voided_at && <div role="status" className="p2ban">Dibatalkan pada {fmtDt(sale.voided_at)} · {sale.void_reason}
        {isOwner && <Link href={`${sale.channel ? "/penjualan/online/baru" : "/kasir"}?replace_sale=${sale.id}`}>Siapkan transaksi pengganti</Link>}
      </div>}
      {openCancel && !sale.voided_at && <div role="status" className="p2ban" style={{ background: "#fff7ed", border: ".5px solid #fdba74", color: "#9a3412" }}>
        <i className="ti ti-receipt-off" /> <strong>Belum dibayar — penerimaan dibatalkan</strong> pada {fmtDt(openCancel.created_at)} · {openCancel.reason}. Uang sudah dikeluarkan dari kas/bank.
        {" "}Terima pembayaran lagi{isOwner ? ", atau ubah transaksi (Batalkan penjualan lalu siapkan pengganti)" : ""}.
      </div>}
      {sale.channel && sale.marketplace_status === "piutang" && !sale.voided_at && onlineCancels.length > 0 && <div role="status" className="p2ban">Pencairan pernah dibatalkan; order ini kembali menjadi piutang marketplace.</div>}
      <div className="crm-sec">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingBottom: 12, borderBottom: ".5px solid var(--bd)", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{sale.no_struk ?? "—"}</div>
            <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>{fmtDt(sale.created_at)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9.5, color: "var(--td)", textTransform: "uppercase", letterSpacing: ".03em" }}>Total</div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{rp(Number(sale.total))}</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <Info label="Cabang" value={one(sale.branches)?.name ?? "—"} />
          <Info label="Pelanggan" value={cust?.name ? `${cust.name}${cust.phone ? ` · ${cust.phone}` : ""}` : "Umum"} />
          <Info label="Kasir" value={one(sale.kasir)?.full_name ?? "—"} />
          <Info label="Metode bayar" value={openCancel ? `${sale.metode_bayar} (penerimaan dibatalkan — belum dibayar)` : sale.metode_bayar} />
          {payments.length > 1 && payments.map(part => <Info key={part.method} label={part.method} value={rp(part.amount)} />)}
          <Info label="Subtotal" value={rp(Number(sale.subtotal))} />
          <Info label="Diskon" value={rp(Number(sale.discount))} />
          {Number(sale.merchant_fee_total) > 0 && <>
            <Info label="Total barang" value={rp(saleMerchandiseTotal(sale))} />
            <Info label="Fee merchant" value={rp(Number(sale.merchant_fee_total))} />
          </>}
          <Info label="Dibayar" value={rp(Number(sale.bayar))} />
          <Info label="Kembalian" value={rp(Number(sale.kembali))} />
        </div>
      </div>

      <div className="crm-sec">
        <SecHeader num="01" title="RINCIAN BARANG" desc="Isi struk penjualan ini." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>No.</th>
                <th>Nama Barang</th>
                <th>Satuan</th>
                <th style={{ textAlign: "center" }}>Qty</th>
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
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(it.harga))}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(it.qty) * Number(it.harga))}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>Tidak ada barang.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {returs.length > 0 && (
        <div className="crm-sec">
          <SecHeader num="02" title="RETUR DARI PENJUALAN INI" desc="Barang yang sudah dikembalikan pelanggan." />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {returs.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", border: ".5px solid var(--bd)", borderRadius: 6, fontSize: 11.5 }}>
                <Link href={`/penjualan/retur/${r.id}`} style={{ fontWeight: 500 }}>{r.no_retur ?? "—"}</Link>
                {r.voided_at && <span>Dibatalkan / diganti · nilai asal</span>}
                <span style={{ color: "var(--tm)", fontSize: 11 }}>
                  {new Date(r.tanggal + "T00:00:00").toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" })}
                </span>
                <span style={{ color: "var(--tm)", fontSize: 11 }}>{r.sales_return_items?.length ?? 0} item</span>
                <span style={{ marginLeft: "auto", fontWeight: 700 }}>{rp(Number(r.total))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tampilRiwayat && <TransactionHistoryPanel title="RIWAYAT PERUBAHAN TRANSAKSI" events={riwayat}
        error={!!correctionError || !!cancellationError || !!receiptError || !!onlineError}
        hint={canCorrectRole ? "Koreksi metode bayar, pembatalan penerimaan, pembatalan dan retur pada struk ini: siapa, kapan, apa, alasan."
          : "Pembatalan dan retur pada struk ini. Koreksi metode bayar hanya terlihat oleh Owner dan Finance."} />}

      {(canCorrectRole || canCancelReceipt) && user && !sale.voided_at && <details className="crm-sec" open={!!openCancel}>
        <summary>{openCancel ? "Struk belum dibayar — terima pembayaran atau ubah transaksi" : isOwner ? "Koreksi, batalkan penerimaan atau batalkan penjualan" : canCorrectRole ? "Koreksi metode pembayaran" : "Batalkan penerimaan"}</summary>
        {receiptError && <p role="alert">Riwayat pembatalan penerimaan belum dapat dibaca. Muat ulang sebelum tindakan berikutnya.</p>}
        {!receiptError && openCancel && canCancelReceipt && <SaleReceiveAgainForm userId={user.id} saleId={sale.id} revision={sale.revision}
          total={Number(sale.total)} previous={openCancel.before_payments.map(part => ({ method: part.method, amount: Number(part.amount) }))} />}
        {!receiptError && !openCancel && canCancelReceipt && !sale.channel && !!sale.payment_plan && !!sale.payments_finalized_at && <SaleReceiptCancelForm userId={user.id} saleId={sale.id}
          revision={sale.revision} total={Number(sale.total)} shiftClosed={shiftClosed} />}
        {!receiptError && !onlineError && canCancelReceipt && !!sale.channel && sale.marketplace_status === "cair" && <OnlineDisbursementCancelForm userId={user.id} saleId={sale.id} revision={sale.revision} />}
        {canCorrectPayment && !correctionError && <SalePaymentCorrectionForm userId={user.id} saleId={sale.id}
          revision={sale.revision} cash={cash} transfer={transfer} change={Number(sale.kembali)}
          fixed={payments.filter(part => part.method !== "Tunai" && part.method !== "Transfer")} />}
        {!isOwner ? null : correctionError ? <p>Riwayat koreksi belum dapat dibaca. Muat ulang sebelum tindakan berikutnya.</p>
          : corrections.length > 0 ? <p>Pembatalan penjualan yang sudah dikoreksi memerlukan rekonsiliasi seluruh jurnal koreksi. Hubungi finance sebelum membatalkan.</p>
          : <SaleCancelForm userId={user.id} saleId={sale.id} revision={sale.revision} />}
      </details>}
      <DokumenPanel modul="penjualan" refId={sale.id} kembali={`/penjualan/${sale.id}`} />
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
