import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NoDok } from "@/components/NoDok";
import { ReportPresets } from "@/components/ReportPresets";
import { SecHeader } from "@/components/SecHeader";
import { paginateReport } from "@/lib/hpp-reports";
import { loadHistoricalInventory, HISTORICAL_INVENTORY_PATH } from "@/lib/inventory-historical";
import { ReportAccessError, ReportInputError } from "@/lib/hpp-reports-server";
import { hariIniWIB } from "@/lib/tanggal";
import { HistoricalFilters } from "./HistoricalFilters";

function number(value: string | null) {
  if (value === null) return "Belum tersedia";
  const [integer, fraction] = value.split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${fraction ? `,${fraction}` : ""}`;
}
const money = (value: string | null) => value === null ? "Belum tersedia" : `Rp ${number(value)}`;

export default async function HistoricalInventoryPage({ searchParams }: {
  searchParams: Promise<{ tanggal?: string; cabang?: string | string[]; halaman?: string }>;
}) {
  const params = await searchParams;
  const selected = params.cabang === undefined ? [] : Array.isArray(params.cabang) ? params.cabang : [params.cabang];
  const requestedDate = params.tanggal || hariIniWIB();
  let report: Awaited<ReturnType<typeof loadHistoricalInventory>> | undefined;
  let errorMessage = "";
  try {
    report = await loadHistoricalInventory(await createClient(), { tanggal: requestedDate, cabang: selected });
  } catch (error) {
    if (error instanceof ReportAccessError) redirect(error.status === 401 ? "/login" : "/laporan");
    errorMessage = error instanceof ReportInputError ? error.message : "Riwayat nilai persediaan belum dapat dibaca lengkap. Muat ulang atau persempit cakupan.";
  }
  const pagination = paginateReport(report?.rows ?? [], params.halaman);
  const pageHref = (page: number) => {
    const query = new URLSearchParams({ tanggal: report?.asOf ?? requestedDate, halaman: String(page) });
    for (const id of report?.selectedIds ?? selected) query.append("cabang", id);
    return `${HISTORICAL_INVENTORY_PATH}?${query}`;
  };
  return <>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}><Link href="/laporan/nilai-persediaan" className="back-btn">← Nilai persediaan saat ini</Link><span>Valuasi as-of</span></div>
    <div className="crm-sec"><SecHeader num="01" title="NILAI PERSEDIAAN AKHIR HARI" desc="Posisi berdasarkan event biaya rata-rata bergerak yang tersimpan." />
      <p style={{ fontSize: 12 }}>Tanggal sebelum aktivasi rata-rata bergerak, termasuk periode FIFO, tidak dapat dinilai ulang dari event ini. Mengaktifkan metode sekarang tidak menciptakan riwayat lama.</p>
      <p style={{ fontSize: 12 }}>Cabang mengikuti hubungan gudang–cabang saat laporan dibaca; riwayat perubahan cabang gudang belum tersimpan sebagai dimensi valuasi. Nilai tidak diposting sebagai jurnal.</p>
    </div>
    {/* No date default is saved: a preset without tanggal keeps opening at today's WIB position. */}
    <Suspense fallback={null}><ReportPresets title="Valuasi as-of" /></Suspense>
    <HistoricalFilters asOf={requestedDate} branches={report?.branches ?? []} selected={report?.selectedIds ?? selected} />
    {errorMessage && <div role="alert" className="p2ban" style={{ color: "#b91c1c" }}>{errorMessage}</div>}
    {report && !report.available && <div role="status" className="p2ban">Nilai as-of dari event rata-rata bergerak belum tersedia untuk {report.asOf}{report.activatedAt ? `; aktivasi tercatat sejak ${report.activatedAt}` : "; metode belum diaktifkan"}. Gunakan snapshot closing yang memang tersimpan untuk periode terkait.</div>}
    {report?.available && <>
      <div className="crm-sec"><SecHeader num="02" title="RINGKASAN CABANG" desc={`Posisi akhir ${report.asOf}; subtotal dihitung dari seluruh baris, bukan hanya halaman ini.`} />
        <p style={{ fontSize: 12 }}>GL 1301 adalah saldo jurnal bertanggal sampai {report.asOf} yang terbaca sekarang, bukan snapshot jurnal terkunci. Jurnal bertanggal lama yang ditambah atau dikoreksi kemudian dapat mengubah perbandingan. Selisih = nilai event dikurangi GL; periksa sumber sebelum koreksi. Cabang event masih mengikuti hubungan gudang saat ini, sehingga angka ini belum membuktikan rekonsiliasi historis cabang.</p>
        <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr><th>Cabang gudang saat ini</th><th>Barang / gudang</th><th>Stok minus</th><th>Nilai minus taksiran</th><th>Nilai event</th><th>GL 1301 as-of</th><th>Selisih</th><th>Buku besar</th></tr></thead><tbody>
          {report.summary.map(branch => <tr key={branch.id}><td>{branch.name}</td><td>{branch.count}</td><td>{branch.negativeCount}</td><td>{money(branch.estimatedValue)}{branch.estimatedCount ? ` (${branch.estimatedCount} baris)` : ""}</td><td>{money(branch.value)}</td><td>{report.canViewLedger ? money(branch.ledgerValue) : "Akses diperlukan"}</td><td>{money(branch.difference)}</td><td>{report.canViewLedger ? <Link href={`/keuangan/buku-besar?akun=1301&sampai=${report.asOf}&cabang=${encodeURIComponent(branch.id)}`}>Lihat jurnal</Link> : "Akses Buku Besar diperlukan"}</td></tr>)}
          <tr><th>Total cabang terpilih</th><td>{report.rows.length}</td><td>{report.summary.reduce((sum, branch) => sum + branch.negativeCount, 0)}</td><td>{money(report.estimatedValue)}{report.estimatedCount ? ` (${report.estimatedCount} baris)` : ""}</td><td>{money(report.total)}</td><td>{report.canViewLedger ? money(report.scopedLedgerValue) : "Akses diperlukan"}</td><td>{money(report.scopedDifference)}</td><td /></tr>
        </tbody></table></div>
        {report.fullBranchAccess && report.selected.length === report.branches.length && report.unallocatedLedger !== null && report.unallocatedLedger !== "0" && <p style={{ fontSize: 12, color: "#b45309" }}>Jurnal 1301 tanpa cabang: {money(report.unallocatedLedger)}. Nilai ini tidak dialokasikan ke cabang dan tidak termasuk total GL cabang di atas.</p>}
        {report.canViewLedger && report.scopedLedgerValue === null && <p style={{ fontSize: 12, color: "#b45309" }}>Akun persediaan 1301 belum tersedia; perbandingan GL tidak dihitung.</p>}
        <p style={{ fontSize: 12 }}>Kebijakan stok minus (R04): bila nilai stok minus tidak tercatat lengkap, nilainya memakai nilai tercatat event terakhir bila ada, atau ditaksir = qty × HPP rata-rata terakhir yang diketahui untuk barang dan gudang itu; barisnya ditandai &quot;taksiran&quot;. Taksiran ini tidak diposting sebagai jurnal, sehingga dapat menimbulkan selisih terhadap GL. Nilai tetap kosong bila HPP barang di gudang itu belum pernah diketahui, atau bila rantai nilai stok positif tidak lengkap.</p>
      </div>
      <div className="crm-sec"><SecHeader num="03" title="RINCIAN EVENT TERAKHIR" desc="Satu posisi terakhir per barang dan gudang sampai tanggal yang dipilih." />
        <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 1000 }}><thead><tr><th>Cabang</th><th>Gudang</th><th>Kode</th><th>Barang</th><th>Satuan</th><th>Qty</th><th>HPP rata-rata</th><th>Nilai</th><th>Event</th><th>Sumber</th></tr></thead><tbody>
          {pagination.rows.map(row => <tr key={row.id}><td>{row.branch}</td><td>{row.warehouseCode} · {row.warehouse}</td><td>{row.itemCode}</td><td>{row.item}</td><td>{row.unit}</td><td>{number(row.qty)}{row.negative ? " · stok minus" : ""}</td><td>{money(row.average)}</td><td>{money(row.value)}{row.valueBasis === "last-average" ? ` · taksiran HPP terakhir Rp ${number(row.estimateAverage)}` : row.valueBasis === "event-unlinked" ? " · taksiran nilai event (rantai tidak lengkap)" : ""}</td><td>{row.sourceDate}</td><td><NoDok source={row.source} nomor={row.sourceRef} /></td></tr>)}
          {!pagination.rows.length && <tr><td colSpan={10}>Belum ada event nilai pada cakupan dan tanggal ini.</td></tr>}
        </tbody></table></div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 12 }}><span>Halaman {pagination.page} dari {pagination.pages} · {report.rows.length} baris</span>{pagination.page > 1 && <Link href={pageHref(pagination.page - 1)}>Sebelumnya</Link>}{pagination.page < pagination.pages && <Link href={pageHref(pagination.page + 1)}>Berikutnya</Link>}</div>
      </div>
    </>}
  </>;
}
