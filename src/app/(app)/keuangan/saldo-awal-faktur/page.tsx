import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { TANGGAL_CUTOVER_DEFAULT, TEMPLATE_SALDO_AWAL_FAKTUR } from "@/lib/saldo-awal-faktur";
import { SaldoAwalFakturForm } from "./SaldoAwalFakturForm";

const rp = (n: number) => "Rp " + Math.round(Number(n)).toLocaleString("id-ID");
type Rel<T> = T | T[] | null;
const one = <T,>(value: Rel<T>) => Array.isArray(value) ? value[0] ?? null : value;
type Batch = {
  id: string; source_name: string; as_of: string; ap_count: number; ap_total: number; ar_count: number; ar_total: number; created_at: string;
  branches: Rel<{ name: string }>; journal_entries: Rel<{ no_jurnal: string }>;
};

export default async function SaldoAwalFakturPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (!profile?.is_active || !["OWNER", "ADMIN", "FINANCE"].includes(profile.role)) {
    return <div className="p2ban">Hanya OWNER/ADMIN/FINANCE aktif yang dapat membuka saldo awal per faktur.</div>;
  }
  const [branchResult, batchResult] = await Promise.all([
    supabase.from("branches").select("id,name").eq("is_active", true).order("name"),
    supabase.from("opening_invoice_batches")
      .select("id,source_name,as_of,ap_count,ap_total,ar_count,ar_total,created_at,branches(name),journal_entries!journal_id(no_jurnal)")
      .order("created_at", { ascending: false }).limit(50),
  ]);
  const error = branchResult.error?.message ?? batchResult.error?.message ?? null;
  const batches = (batchResult.data ?? []) as unknown as Batch[];

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
        <li>OWNER memposting sekali. Hasilnya satu jurnal saldo awal; tidak ada stok, HPP, PPN, pembelian, atau pendapatan periode berjalan.</li>
      </ol>
      <p style={{ fontSize: 11, color: "var(--tm)" }}>
        Hutang Usaha (2101) dan Piutang Usaha (1201) diisi di sini, <strong>bukan</strong> di Saldo Awal per akun. Kalau salah satu akun itu sudah punya saldo awal satu total, impor jenis tersebut ditolak supaya tidak tercatat ganda.
      </p>
      {error ? <div className="p2ban" role="alert">Gagal memuat data: {error}</div>
        : <SaldoAwalFakturForm branches={(branchResult.data ?? []) as { id: string; name: string }[]} defaultAsOf={TANGGAL_CUTOVER_DEFAULT} isOwner={profile.role === "OWNER"} />}
    </section>
    <section className="crm-sec">
      <SecHeader num="02" title="BATCH TERPOSTING" desc="Riwayat impor saldo awal per faktur. Batch tidak dapat dihapus; file yang sama tidak bisa terposting dua kali." />
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
  </>;
}
