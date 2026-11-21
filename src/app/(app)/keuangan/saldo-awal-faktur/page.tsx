import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { TANGGAL_CUTOVER_DEFAULT, TEMPLATE_SALDO_AWAL_FAKTUR } from "@/lib/saldo-awal-faktur";
import { SaldoAwalFakturForm } from "./SaldoAwalFakturForm";
import { KoreksiSaldoAwalFaktur } from "./KoreksiSaldoAwalFaktur";
import type { OpeningInvoiceCorrectionRow } from "./types";

const rp = (n: number) => "Rp " + Math.round(Number(n)).toLocaleString("id-ID");
type Rel<T> = T | T[] | null;
const one = <T,>(value: Rel<T>) => Array.isArray(value) ? value[0] ?? null : value;
type Batch = {
  id: string; source_name: string; as_of: string; ap_count: number; ap_total: number; ar_count: number; ar_total: number; created_at: string;
  branches: Rel<{ name: string }>; journal_entries: Rel<{ no_jurnal: string }>;
};
type Koreksi = {
  id: string; jenis: string; old_total: number; new_total: number; delta: number; reason: string; created_at: string;
  purchase_invoices: Rel<{ no_faktur: string }>; sales_invoices: Rel<{ no_faktur: string }>;
  journal_entries: Rel<{ no_jurnal: string }>; profiles: Rel<{ full_name: string | null }>;
};
const waktu = (iso: string) => new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });

export default async function SaldoAwalFakturPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (!profile?.is_active || !["OWNER", "ADMIN", "FINANCE"].includes(profile.role)) {
    return <div className="p2ban">Hanya OWNER/ADMIN/FINANCE aktif yang dapat membuka saldo awal per faktur.</div>;
  }
  const [branchResult, batchResult, rowResult, koreksiResult] = await Promise.all([
    supabase.from("branches").select("id,name").eq("is_active", true).order("name"),
    supabase.from("opening_invoice_batches")
      .select("id,source_name,as_of,ap_count,ap_total,ar_count,ar_total,created_at,branches(name),journal_entries!journal_id(no_jurnal)")
      .order("created_at", { ascending: false }).limit(50),
    supabase.rpc("opening_invoice_correction_rows"),
    supabase.from("opening_invoice_corrections")
      .select("id,jenis,old_total,new_total,delta,reason,created_at,purchase_invoices(no_faktur),sales_invoices(no_faktur),journal_entries!journal_id(no_jurnal),profiles!created_by(full_name)")
      .order("created_at", { ascending: false }).limit(100),
  ]);
  const error = branchResult.error?.message ?? batchResult.error?.message ?? null;
  const batches = (batchResult.data ?? []) as unknown as Batch[];
  const koreksiError = rowResult.error?.message ?? koreksiResult.error?.message ?? null;
  const koreksiRows = (rowResult.data ?? []) as OpeningInvoiceCorrectionRow[];
  const riwayat = (koreksiResult.data ?? []) as unknown as Koreksi[];

  return <>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
      <Link href="/keuangan/saldo-awal" className="back-btn"><i className="ti ti-arrow-left" /> Saldo Awal</Link>
      <span style={{ color: "var(--td)" }}>·</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>Saldo Awal Hutang &amp; Piutang per Faktur</span>
    </div>
    <section className="crm-sec">
      <SecHeader num="01" title="IMPOR FAKTUR TERBUKA DARI ACCURATE"
        desc="Setiap faktur yang belum lunas per tanggal cutover masuk sebagai faktur sendiri, jadi pembayaran nanti bisa dialokasikan ke faktur lama yang tepat lewat layar Pembayaran Hutang dan Faktur Penjualan." />
      <ol style={{ fontSize: 12, lineHeight: 1.7, margin: "0 0 10px 18px" }}>
        <li>Unduh <a href="/keuangan/saldo-awal-faktur/template">{TEMPLATE_SALDO_AWAL_FAKTUR}</a>, isi satu baris per faktur terbuka dengan <strong>sisa tagihan</strong> (bukan total faktur). Tanggal faktur dan jatuh tempo diisi bila tersedia; yang kosong disimpan kosong.</li>
        <li>Pastikan semua pemasok dan pelanggan sudah ada di master VetOS. Nama yang belum ada ditolak, tidak dibuat otomatis.</li>
        <li>Unggah, isi total kontrol dari laporan umur hutang/piutang Accurate, lalu periksa. Semua baris salah ditandai sebelum ada yang tersimpan.</li>
        <li>OWNER atau FINANCE memposting sekali. Hasilnya satu jurnal saldo awal; tidak ada stok, HPP, PPN, pembelian, atau pendapatan periode berjalan.</li>
      </ol>
      <p style={{ fontSize: 11, color: "var(--tm)" }}>
        Hutang Usaha (311001) dan Piutang Usaha (150001) diisi di sini, <strong>bukan</strong> di Saldo Awal per akun. Kalau salah satu akun itu sudah punya saldo awal satu total, impor jenis tersebut ditolak supaya tidak tercatat ganda.
      </p>
      {error ? <div className="p2ban" role="alert">Gagal memuat data: {error}</div>
        : <SaldoAwalFakturForm branches={(branchResult.data ?? []) as { id: string; name: string }[]} defaultAsOf={TANGGAL_CUTOVER_DEFAULT} canPost={profile.role === "OWNER" || profile.role === "FINANCE"} />}
    </section>
    <section className="crm-sec">
      <SecHeader num="02" title="BATCH TERPOSTING" desc="Riwayat impor saldo awal per faktur. Batch tidak dapat dihapus; file yang sama tidak bisa terposting dua kali. Total hutang/piutang sudah termasuk koreksi per faktur." />
      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 720 }}>
          <thead><tr><th>Tanggal saldo</th><th>File</th><th>Cabang</th><th>Jurnal</th><th style={{ textAlign: "right" }}>Hutang</th><th style={{ textAlign: "right" }}>Piutang</th></tr></thead>
          <tbody>
            {batches.map(b => <tr key={b.id}>
              <td style={{ fontSize: 11 }}>{b.as_of}</td>
              <td style={{ fontSize: 11 }}>{b.source_name}</td>
              <td style={{ fontSize: 11 }}>{one(b.branches)?.name ?? "—"}</td>
              <td style={{ fontSize: 11, fontFamily: "monospace" }}>{one(b.journal_entries)?.no_jurnal ?? "—"}</td>
              <td style={{ textAlign: "right", fontSize: 11 }}>{b.ap_count} faktur · {rp(b.ap_total)}</td>
              <td style={{ textAlign: "right", fontSize: 11 }}>{b.ar_count} faktur · {rp(b.ar_total)}</td>
            </tr>)}
            {!batches.length && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: 16, fontSize: 11 }}>Belum ada batch terposting.</td></tr>}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: "var(--tm)" }}>
        Bayar hutang lama di <Link href="/keuangan/hutang">Pembayaran Hutang</Link>; terima piutang lama di <Link href="/penjualan/faktur">Faktur &amp; Penerimaan Penjualan</Link>.
      </p>
    </section>
    <section className="crm-sec" id="koreksi">
      <SecHeader num="03" title="KOREKSI NILAI SALDO AWAL PER FAKTUR"
        desc="Kalau nilai satu faktur hasil impor ternyata salah, OWNER mengoreksinya di sini dengan alasan. Selisihnya dibukukan sebagai jurnal koreksi baru di tanggal saldo awal; nilai tidak boleh lebih kecil dari yang sudah dibayar/diterima." />
      {koreksiError ? <div className="p2ban" role="alert">Gagal memuat data koreksi: {koreksiError}</div>
        : <KoreksiSaldoAwalFaktur rows={koreksiRows} isOwner={profile.role === "OWNER"} />}
      <div style={{ fontSize: 12, fontWeight: 600, margin: "16px 0 6px" }}>Riwayat koreksi</div>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 760 }}>
          <thead><tr><th>Waktu</th><th>Faktur</th><th style={{ textAlign: "right" }}>Lama</th><th style={{ textAlign: "right" }}>Baru</th><th style={{ textAlign: "right" }}>Selisih</th><th>Jurnal</th><th>Oleh</th><th>Alasan</th></tr></thead>
          <tbody>
            {riwayat.map(k => <tr key={k.id}>
              <td style={{ fontSize: 11 }}>{waktu(k.created_at)}</td>
              <td style={{ fontSize: 11, fontFamily: "monospace" }}>{one(k.purchase_invoices)?.no_faktur ?? one(k.sales_invoices)?.no_faktur ?? "—"}</td>
              <td style={{ textAlign: "right", fontSize: 11 }}>{rp(k.old_total)}</td>
              <td style={{ textAlign: "right", fontSize: 11 }}>{rp(k.new_total)}</td>
              <td style={{ textAlign: "right", fontSize: 11 }}>{Number(k.delta) > 0 ? "+" : "−"}{rp(Math.abs(Number(k.delta)))}</td>
              <td style={{ fontSize: 11, fontFamily: "monospace" }}>{one(k.journal_entries)?.no_jurnal ?? "—"}</td>
              <td style={{ fontSize: 11 }}>{one(k.profiles)?.full_name ?? "—"}</td>
              <td style={{ fontSize: 11 }}>{k.reason}</td>
            </tr>)}
            {!riwayat.length && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: 16, fontSize: 11 }}>Belum ada koreksi.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </>;
}
