import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { loadInventoryClosing, INVENTORY_CLOSING_PATH } from "@/lib/inventory-closing";
import { ReportAccessError } from "@/lib/hpp-reports-server";
import { paginateReport } from "@/lib/hpp-reports";
import { hariIniWIB } from "@/lib/tanggal";
import { periodeSelesai } from "@/lib/akhir-bulan";
import { labelBulan } from "@/lib/pertumbuhan";
import { reportWIB } from "@/lib/hpp-reports-export";
import { ActivationForm, ClosingForm } from "./ClosingForms";

const money = (value: number | string | null) => value === null ? "Belum tersedia" : `Rp ${Number(value).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (value: number | string) => Number(value).toLocaleString("id-ID", { maximumFractionDigits: 8 });

export default async function InventoryClosingPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string; snapshot?: string; halaman?: string }> }) {
  const params = await searchParams;
  let report: Awaited<ReturnType<typeof loadInventoryClosing>> | undefined;
  let readError = "";
  try {
    report = await loadInventoryClosing(await createClient(), params.snapshot);
  } catch (error) {
    if (error instanceof ReportAccessError) redirect(error.status === 401 ? "/login" : "/keuangan");
    readError = "Closing HPP belum bisa dibaca lengkap. Muat ulang atau hubungi administrator.";
  }
  const average = report?.method === "moving_average";
  const pagination = paginateReport(report?.values ?? [], params.halaman);
  const pageHref = (page: number) => `${INVENTORY_CLOSING_PATH}?snapshot=${encodeURIComponent(report?.activeClose?.id ?? "")}&halaman=${page}`;
  return <>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}><Link href="/keuangan/tutup-buku" className="back-btn">← Tutup Buku</Link><span>Closing HPP Bulanan</span></div>
    {params.success && <div role="status" className="p2ban" style={{ color: "#15803d", background: "#e8f5ee" }}>{params.success}</div>}
    {(params.error || readError) && <div role="alert" className="p2ban" style={{ color: "#b91c1c", background: "#fef2f2" }}>{params.error || readError}</div>}
    {report && <>
      <div className="crm-sec">
        <SecHeader num="01" title="METODE HARGA POKOK" desc="Metode penilaian persediaan dan HPP transaksi baru." />
        <p style={{ fontSize: 14, fontWeight: 700 }}>{average ? "Rata-rata bergerak" : "FIFO"}{report.activatedAt ? ` · aktif sejak ${reportWIB(report.activatedAt)} WIB` : ""}</p>
        <p style={{ fontSize: 12, color: "var(--tm)", lineHeight: 1.7 }}>Setiap barang masuk memperbarui HPP rata-rata per barang dan gudang. Pengeluaran memakai HPP saat transaksi. Batch dan tanggal kadaluarsa tetap mengikuti barang fisik.</p>
        {!average && <><p style={{ fontSize: 12, color: "var(--tm)", lineHeight: 1.7 }}>Aktivasi memakai nilai lapisan stok yang tersedia sebagai saldo awal. HPP transaksi lama tetap tersimpan. Metode ini tidak dapat dikembalikan ke FIFO melalui halaman ini.</p><ActivationForm disabled={!report.allBranches} /></>}
        {!report.allBranches && <p style={{ fontSize: 12, color: "#b45309" }}>Aktivasi dan closing berlaku untuk seluruh cabang dan memerlukan akses seluruh cabang. Riwayat di bawah hanya menampilkan nilai cabang yang dapat Anda akses.</p>}
        <Link href="/laporan/nilai-persediaan" className="back-btn" style={{ display: "inline-block", marginTop: 12 }}>Lihat nilai persediaan saat ini →</Link>
      </div>
      <div className="crm-sec">
        <SecHeader num="02" title="CLOSING HPP BULANAN" desc="Simpan qty, HPP rata-rata dan nilai persediaan akhir bulan, lalu kunci periode persediaan." />
        <ClosingForm month={periodeSelesai(hariIniWIB())} disabled={!average || !report.allBranches} />
        <p style={{ fontSize: 12, color: "var(--tm)", lineHeight: 1.7 }}>Pilih bulan yang sudah selesai. Snapshot yang tersimpan tidak berubah ketika ada transaksi bulan berikutnya. Periode yang sudah ditutup tidak dapat dibuka kembali dari halaman ini.</p>
        {!average && <p style={{ fontSize: 12, color: "#b45309" }}>Aktifkan rata-rata bergerak sebelum closing HPP.</p>}
      </div>
      <div className="crm-sec">
        <SecHeader num="03" title="RIWAYAT SNAPSHOT" desc="Nilai snapshot sesuai cabang yang dapat Anda akses, termasuk gudang nonaktif." />
        <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 650, width: "100%" }}><thead><tr><th>Bulan</th><th>Terkunci sampai</th><th>Disimpan WIB</th><th>Barang / gudang</th><th>Nilai persediaan</th></tr></thead><tbody>
          {report.history.map(close => <tr key={close.id}><td><Link href={`${INVENTORY_CLOSING_PATH}?snapshot=${encodeURIComponent(close.id)}`}>{labelBulan(close.period.slice(0, 7))}</Link></td><td>{close.closed_through}</td><td>{reportWIB(close.closed_at)}</td><td>{close.scopedCount}</td><td>{money(close.scopedValue)}</td></tr>)}
          {!report.history.length && <tr><td colSpan={5}>Belum ada snapshot closing HPP.</td></tr>}
        </tbody></table></div>
      </div>
      {report.activeClose && <div className="crm-sec">
        <SecHeader num="04" title={`RINCIAN ${labelBulan(report.activeClose.period.slice(0, 7)).toUpperCase()}`} desc="Qty dalam satuan dasar. HPP dan nilai berasal dari snapshot tersimpan." />
        <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 850, width: "100%" }}><thead><tr><th>Cabang</th><th>Gudang</th><th>Kode</th><th>Barang</th><th>Satuan</th><th>Qty</th><th>HPP rata-rata</th><th>Nilai</th></tr></thead><tbody>
          {pagination.rows.map(value => <tr key={`${value.warehouse_id}:${value.item_id}`}><td>{value.branch}</td><td>{value.warehouse}</td><td>{value.code}</td><td>{value.item}</td><td>{value.unit}</td><td>{qty(value.qty)}</td><td>{money(value.average_cost)}</td><td>{money(value.value)}</td></tr>)}
          {!pagination.rows.length && <tr><td colSpan={8}>Tidak ada saldo snapshot pada cabang yang dapat Anda akses.</td></tr>}
        </tbody></table></div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, fontSize: 12 }}><span>Halaman {pagination.page} dari {pagination.pages} · {report.values.length} baris</span>{pagination.page > 1 && <Link className="btn-def" href={pageHref(pagination.page - 1)}>Sebelumnya</Link>}{pagination.page < pagination.pages && <Link className="btn-def" href={pageHref(pagination.page + 1)}>Berikutnya</Link>}</div>
      </div>}
    </>}
  </>;
}
