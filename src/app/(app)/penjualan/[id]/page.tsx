import { formatPosMoney } from "@/lib/pos-money";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { DokumenPanel } from "@/components/dokumen/DokumenPanel";
import { saleMerchandiseTotal, salePaymentAllocations, type SalePaymentSource } from "@/lib/sale-payment-reporting";
import { TransactionHistoryPanel } from "@/components/TransactionHistoryPanel";
import { bolehLihatRiwayat, petshopHistory, type PetshopEdit, type PetshopOnlineCancel, type PetshopReceiptCancel } from "@/lib/transaction-history";
import { alasanTidakBisaUbah } from "@/lib/ubah-struk";
import { alasanUbahTransaksiTerhalang, bulanJakarta } from "@/lib/ubah-transaksi-petshop";
import { loadActorNames } from "@/lib/transaction-history-server";
import { bacaBatasTanggal, batasCadangan, catatanTanggalEfektif, tanggalId, tanggalIsoValid, tanggalWibDariWaktu, type BatasTanggal } from "@/lib/tanggal-efektif-petshop";

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
  voucher_code?: string | null;
  sale_items: { id: string; nama: string; qty: number; harga: number; satuan: string | null; promo_id?: string | null }[] | null;
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
  searchParams: Promise<{ success?: string; error?: string; shift?: string; tgl?: string }>;
}) {
  const { id } = await params;
  const { success, error, shift: shiftParam, tgl } = await searchParams;
  const tglCatatan = tgl && tanggalIsoValid(tgl) ? ` Dibukukan di tanggal ${tanggalId(tgl)} (bukan hari ini); struk dan omzet tanggal struk tidak berubah.` : "";
  const shiftLain = shiftParam === "lain";
  const shiftTanpa = shiftParam === "tanpa";
  const supabase = await createClient();

  const { data } = await supabase
    .from("sales")
    .select("id, revision, channel, void_reason, branch_id, shift_id, marketplace_status, no_struk, created_at, subtotal, discount, total, merchant_fee_total, metode_bayar, bayar, kembali, payment_plan, payments_finalized_at, voided_at, sale_payments(method, amount, fee_percent, fee_amount), branches(name), customers(name, phone), kasir:cashier_id(full_name), voucher_code, sale_items(id, nama, qty, harga, satuan, promo_id)")
    .eq("id", id)
    .maybeSingle();

  const sale = data as unknown as Sale | null;
  if (!sale) notFound();
  const payments = salePaymentAllocations(sale);
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user ? await supabase.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle() : { data: null };
  const isOwner = profile?.role === "OWNER" && profile.is_active === true;
  // R4 (audit 11 Nov): peringatan dini bahwa isi struk tak bisa diubah lewat "Batalkan penjualan" (voucher/promo/penggajian). Hanya peringatan; gagal baca = tanpa peringatan.
  const payrollRes = isOwner && !sale.voided_at ? await supabase.from("payrolls").select("id", { count: "exact", head: true }).eq("periode", bulanJakarta(sale.created_at)) : null;
  const ubahTerhalang = alasanUbahTransaksiTerhalang({ voucherCode: sale.voucher_code, promoItemCount: (sale.sale_items ?? []).filter(i => !!i.promo_id).length, payrollMonthExists: !!payrollRes && !payrollRes.error && (payrollRes.count ?? 0) > 0 });
  // J02: koreksi metode (juga sesudah shift ditutup) boleh Owner dan Finance; pembatalan tetap Owner.
  const canCorrectRole = isOwner || (profile?.role === "FINANCE" && profile.is_active === true);

  // Batalkan penerimaan: catatan struk ini, status shift asal, dan hak peran (Owner tidak pernah terkunci).
  const { data: receiptData, error: receiptError } = await supabase.from("pos_receipt_cancellations")
    .select("id, reason, created_at, created_by, source_shift_status, source_shift_id, effect_shift_id, shift_mode, before_payments, after_payments, closed_at, closed_by, closed_kind, effective_date, receive_effective_date, receive_reason")
    .eq("sale_id", id).order("created_at", { ascending: true });
  const receiptCancels = (receiptData ?? []) as unknown as PetshopReceiptCancel[];
  const openCancel = receiptCancels.find(c => !c.closed_at) ?? null;
  const { data: onlineData, error: onlineError } = sale.channel
    ? await supabase.from("online_disbursement_cancellations").select("id, reason, created_at, created_by, amount_bank, amount_fee, effective_date").eq("sale_id", id).order("created_at", { ascending: true })
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
  // Tanggal efektif (backdate): rentang dibaca dari database (pratinjau); gagal baca = rentang dasar, Owner tidak dikunci layar (database memutuskan).
  let batasTanggal: BatasTanggal | null = null;
  if (canCancelReceipt && !sale.voided_at && !receiptError && !onlineError) {
    const op = openCancel ? "receive" : sale.channel ? "online" : "cancel";
    const wajib = openCancel || (sale.channel ? sale.marketplace_status === "cair" : !!sale.payment_plan && !!sale.payments_finalized_at);
    if (wajib) {
      const { data: batas } = await supabase.rpc("pos_receipt_date_bounds", { p_sale_id: sale.id, p_op: op });
      batasTanggal = bacaBatasTanggal(batas) ?? batasCadangan(tanggalWibDariWaktu(sale.created_at), isOwner);
    }
  }

  const { data: returData } = await supabase
    .from("sales_returns")
    .select("id, no_retur, tanggal, total, voided_at, sales_return_items(id, nama, qty)")
    .eq("sale_id", id)
    .order("tanggal", { ascending: false });
  const returs = (returData ?? []) as unknown as ReturRow[];
  // Ubah transaksi: struk ini diganti (old) atau hasil ubah (new). Dibaca lewat RLS sale_edits (cabang + modul penjualan).
  const { data: editData } = await supabase.from("sale_edits")
    .select("id, created_at, created_by, reason, old_sale_id, new_sale_id, before_value, after_value, lama:old_sale_id(no_struk), baru:new_sale_id(no_struk)")
    .or(`old_sale_id.eq.${id},new_sale_id.eq.${id}`);
  type EditRow = { id: string; created_at: string; created_by: string | null; reason: string; old_sale_id: string; new_sale_id: string;
    before_value: { sale?: { total?: number } } | null; after_value: { sale?: { total?: number } } | null;
    lama: Rel<{ no_struk: string | null }>; baru: Rel<{ no_struk: string | null }> };
  const editRows = (editData ?? []) as unknown as EditRow[];
  const edits: PetshopEdit[] = editRows.map(e => ({ id: e.id, created_at: e.created_at, created_by: e.created_by, reason: e.reason,
    arah: e.old_sale_id === id ? "ke" : "dari", no_lama: one(e.lama)?.no_struk ?? "struk lama", no_baru: one(e.baru)?.no_struk ?? "struk baru",
    total_lama: Number(e.before_value?.sale?.total ?? 0), total_baru: Number(e.after_value?.sale?.total ?? 0) }));
  const diubahKe = editRows.find(e => e.old_sale_id === id) ?? null;
  const hasilDari = editRows.find(e => e.new_sale_id === id) ?? null;
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
    ? await loadActorNames(supabase, [...corrections.map(c => c.created_by), ...edits.map(e => e.created_by), cancellationData?.created_by, ...receiptCancels.flatMap(c => [c.created_by, c.closed_by]), ...onlineCancels.map(c => c.created_by)])
    : { names: new Map<string, string>(), error: false };
  const riwayat = tampilRiwayat ? petshopHistory({
    viewerId: user?.id ?? null, names: actors.names, corrections,
    cancellation: (cancellationData as { id: string; reason: string; created_at: string; created_by: string | null } | null) ?? null,
    returns: returs, receiptCancellations: receiptCancels, onlineCancellations: onlineCancels, edits,
  }) : [];
  const cash = payments.find(part => part.method === "Tunai")?.amount ?? 0;
  const transfer = payments.find(part => part.method === "Transfer")?.amount ?? 0;
  const canCorrectPayment = canCorrectRole && !!user && !sale.voided_at && !sale.channel && !!sale.payment_plan && !openCancel && !hasReceiptCycle
    && !!sale.payments_finalized_at && cash + transfer > 0
    && returs.length === 0 && !sale.sale_payments?.some(part => ["Tunai", "Transfer"].includes(part.method)
      && (Number(part.fee_amount) !== 0 || Number(part.fee_percent) !== 0));

  const items = sale.sale_items ?? [];
  const cust = one(sale.customers);
  const canEdit = canCorrectRole && !!user && !alasanTidakBisaUbah(sale, { receiptCycle: hasReceiptCycle, returns: returs.some(r => !r.voided_at) });

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 11, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/penjualan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
          <span style={{ color: "var(--td)" }}>·</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{sale.no_struk ?? "Penjualan"}</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {canEdit && <Link href={`/penjualan/${sale.id}/ubah`} className="btn-acc" style={{ textDecoration: "none" }}>
          <i className="ti ti-edit" /> Ubah transaksi
        </Link>}
        {!sale.voided_at && <Link href={`/penjualan/retur/baru?struk=${encodeURIComponent(sale.no_struk ?? "")}`} className="btn-def" style={{ textDecoration: "none" }}>
          <i className="ti ti-arrow-back-up" /> Buat retur
        </Link>}
        </div>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success === "cancelled" ? "Penjualan dibatalkan. Riwayat dan pembalikannya tersimpan."
            : success === "edited" ? "Transaksi diubah. Ini struk hasil ubah: tetap di tanggal struk asli, struk lama tersimpan di riwayat."
            : success === "payment-corrected" ? "Metode pembayaran terkoreksi pada penjualan ini. Jurnal pembalik dan pengganti tersimpan."
            : success === "receipt-cancelled" ? `Penerimaan dibatalkan: uang dikeluarkan dari kas/bank dan struk menjadi belum dibayar.${shiftLain ? " Shift asal struk sudah ditutup; angka tutupnya tidak diubah, pengembalian dicatat di shift terbuka Anda." : ""}${shiftTanpa ? " Shift asal struk sudah ditutup dan Anda tidak punya shift terbuka: pengembalian tunai ditandai \"tanpa shift\" untuk Finance dan tidak mengubah laci kasir mana pun." : ""}${tglCatatan} Terima pembayaran lagi atau ubah transaksi di bawah.`
            : success === "receipt-received" ? `Pembayaran diterima ulang. Jurnal dan laci shift tercatat.${shiftTanpa ? " Anda tidak punya shift terbuka: uang tunai ditandai \"tanpa shift\" untuk Finance dan tidak masuk laci kasir mana pun." : ""}${tglCatatan}`
            : success === "disbursement-cancelled" ? `Pencairan dibatalkan: order kembali menjadi piutang marketplace.${tglCatatan}` : "Dokumen tersimpan."}
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      {sale.voided_at && diubahKe && <div role="status" className="p2ban">Struk ini sudah <strong>diubah</strong> pada {fmtDt(diubahKe.created_at)} · {diubahKe.reason}.{" "}
        <Link href={`/penjualan/${diubahKe.new_sale_id}`}>Buka struk terbaru {one(diubahKe.baru)?.no_struk ?? ""}</Link>
      </div>}
      {sale.voided_at && !diubahKe && <div role="status" className="p2ban">Dibatalkan pada {fmtDt(sale.voided_at)} · {sale.void_reason}
        {isOwner && <Link href={`${sale.channel ? "/penjualan/online/baru" : "/kasir"}?replace_sale=${sale.id}`}>Siapkan transaksi pengganti</Link>}
      </div>}
      {hasilDari && !sale.voided_at && <div role="status" className="p2ban">Hasil ubah dari{" "}
        <Link href={`/penjualan/${hasilDari.old_sale_id}`}>{one(hasilDari.lama)?.no_struk ?? "struk lama"}</Link> pada {fmtDt(hasilDari.created_at)} · {hasilDari.reason}. Tanggal struk tetap tanggal asli.
      </div>}
      {openCancel && !sale.voided_at && <div role="status" className="p2ban" style={{ background: "#fff7ed", border: ".5px solid #fdba74", color: "#9a3412" }}>
        <i className="ti ti-receipt-off" /> <strong>Belum dibayar — penerimaan dibatalkan</strong> pada {fmtDt(openCancel.created_at)} · {openCancel.reason}. Uang sudah dikeluarkan dari kas/bank.{catatanTanggalEfektif(openCancel.effective_date, openCancel.created_at) ? ` ${catatanTanggalEfektif(openCancel.effective_date, openCancel.created_at)}.` : ""}
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
        hint={canCorrectRole ? "Ubah transaksi, koreksi metode bayar, pembatalan penerimaan, pembatalan dan retur pada struk ini: siapa, kapan, apa, alasan."
          : "Pembatalan dan retur pada struk ini. Koreksi metode bayar hanya terlihat oleh Owner dan Finance."} />}

      {(canCorrectRole || canCancelReceipt) && user && !sale.voided_at && <details className="crm-sec" open={!!openCancel}>
        <summary>{openCancel ? "Struk belum dibayar — terima pembayaran atau ubah transaksi" : isOwner ? "Koreksi, batalkan penerimaan atau batalkan penjualan" : canCorrectRole ? "Koreksi metode pembayaran" : "Batalkan penerimaan"}</summary>
        {receiptError && <p role="alert">Riwayat pembatalan penerimaan belum dapat dibaca. Muat ulang sebelum tindakan berikutnya.</p>}
        {!receiptError && openCancel && canCancelReceipt && <SaleReceiveAgainForm userId={user.id} saleId={sale.id} revision={sale.revision}
          total={Number(sale.total)} previous={openCancel.before_payments.map(part => ({ method: part.method, amount: Number(part.amount) }))} batasTanggal={batasTanggal} />}
        {!receiptError && !openCancel && canCancelReceipt && !sale.channel && !!sale.payment_plan && !!sale.payments_finalized_at && <SaleReceiptCancelForm userId={user.id} saleId={sale.id}
          revision={sale.revision} total={Number(sale.total)} shiftClosed={shiftClosed} ubahTerhalang={ubahTerhalang} batasTanggal={batasTanggal} />}
        {!receiptError && !onlineError && canCancelReceipt && !!sale.channel && sale.marketplace_status === "cair" && <OnlineDisbursementCancelForm userId={user.id} saleId={sale.id} revision={sale.revision} batasTanggal={batasTanggal} />}
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
