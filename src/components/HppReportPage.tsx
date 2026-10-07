import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "./LaporanPage";
import { loadCompoundReport, loadInventoryReport, normalizeReportFilters, REPORT_PATHS, type ReportKind, type ReportParams, type CompoundReport, type InventoryReport } from "@/lib/hpp-reports-server";
import { compoundTable, compoundIngredientsTable, compoundReconciliationTable, inventoryTable, reportWIB, type ReportCell, type ReportColumn } from "@/lib/hpp-reports-export";
import { hppReportError } from "@/lib/hpp-reports-download";
import { paginateReport } from "@/lib/hpp-reports";

const money = (value: number | null) => value === null ? "Belum lengkap" : `Rp ${value.toLocaleString("id-ID",{ minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (value: number | null) => value === null ? "—" : `${value.toLocaleString("id-ID",{ maximumFractionDigits: 2 })}%`;
function cellText(value: ReportCell, column: ReportColumn): string {
  if (value === null) return "—";
  if (typeof value === "number") {
    if (column.format === "money") return money(value);
    if (column.format === "percent") return percent(value);
    return value.toLocaleString("id-ID",{ maximumFractionDigits: 8 });
  }
  return value;
}

export async function HppReportPage({ kind, params }: { kind: ReportKind; params: ReportParams }) {
  let report: InventoryReport | CompoundReport | undefined;
  let message = "";
  try {
    const client = await createClient();
    report = kind === "inventory" ? await loadInventoryReport(client,params) : await loadCompoundReport(client,params);
  } catch (error) {
    const failure = hppReportError(error);
    if (failure.status === 401) redirect("/login");
    if (failure.status === 403) redirect("/laporan");
    message = failure.message;
  }
  const filters = report?.filters ?? normalizeReportFilters(params);
  const branches = report?.scope.branches ?? [];
  const inventory = report && "warehouses" in report ? report : undefined;
  const compound = report && "doctors" in report ? report : undefined;
  const ingredientView = kind === "compound" && params.rincian === "bahan";
  const reconciliationView = kind === "compound" && params.rincian === "rekonsiliasi";
  const table = inventory ? inventoryTable(inventory) : compound ? reconciliationView ? compoundReconciliationTable(compound) : ingredientView ? compoundIngredientsTable(compound) : compoundTable(compound) : undefined;
  const pagination = paginateReport(table?.rows ?? [],params.halaman);
  const path = REPORT_PATHS[kind];
  const query = new URLSearchParams({ cabang: filters.cabang, q: filters.q,
    ...(kind === "inventory" ? { gudang: filters.gudang, masalah: filters.masalah } : { dari: filters.dari, sampai: filters.sampai, dokter: filters.dokter, ...(reconciliationView ? { rincian: "rekonsiliasi" } : ingredientView ? { rincian: "bahan" } : {}) }) });
  const pageHref = (page: number) => `${path}?${query}&halaman=${page}`;
  const cards = inventory ? [
    { label: "Barang / gudang", nilai: String(inventory.summary.count) },
    { label: "Subtotal lapisan ber-HPP", nilai: money(inventory.summary.pricedValue) },
    { label: "Nilai persediaan lengkap", nilai: money(inventory.summary.value) },
    { label: "Baris perlu rekonsiliasi / HPP", nilai: String(inventory.summary.incomplete), warna: inventory.summary.incomplete ? "#b45309" : "#15803d" },
  ] : compound ? [
    { label: "Baris / jumlah racikan", nilai: `${compound.rows.length} / ${compound.summary.qty.toLocaleString("id-ID")}` },
    { label: "Penjualan setelah diskon item", nilai: money(compound.summary.revenue) },
    { label: "HPP baris tercakup", nilai: money(compound.summary.cost) },
    { label: "Laba kotor baris tercakup", nilai: money(compound.summary.grossProfit) },
    { label: "Margin baris tercakup", nilai: percent(compound.summary.margin) },
    { label: "Baris perlu rekonsiliasi tautan / HPP", nilai: String(compound.reconciliation.length), warna: compound.reconciliation.length ? "#b45309" : "#15803d" },
    { label: "Baris tanpa HPP", nilai: String(compound.summary.missingCost), warna: compound.summary.missingCost ? "#b45309" : "#15803d" },
  ] : [];
  return <LaporanPage icon={kind === "inventory" ? "ti-package" : "ti-flask"}
    title={kind === "inventory" ? "NILAI PERSEDIAAN FIFO SAAT INI" : "HPP & MARGIN RACIKAN"}
    desc={kind === "inventory" ? "Saldo satuan dasar dan nilai lapisan tersisa, termasuk barang atau gudang nonaktif." : "Racikan yang sudah ditagih pada invoice aktif, dengan HPP historis setiap baris."}
    unduhTampilan={false}
    filter={<>
      {kind === "compound" && <>
        <div><label className="flab">Dari tanggal (WIB)</label><input className="fi" name="dari" type="date" defaultValue={filters.dari} /></div>
        <div><label className="flab">Sampai tanggal (WIB)</label><input className="fi" name="sampai" type="date" defaultValue={filters.sampai} /></div>
      </>}
      <div><label className="flab">Cabang</label><select className="fi" name="cabang" defaultValue={filters.cabang}>
        <option value="">Semua cabang</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></div>
      {kind === "inventory" && <>
        <div><label className="flab">Gudang</label><select className="fi" name="gudang" defaultValue={filters.gudang}>
          <option value="">Semua gudang</option>{inventory?.warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} ({warehouse.type}){!warehouse.is_active ? " · nonaktif" : ""}</option>)}
        </select></div>
        <div><label className="flab">Cakupan</label><select className="fi" name="masalah" defaultValue={filters.masalah}>
          <option value="">Semua saldo</option><option value="ya">Perlu rekonsiliasi / HPP</option>
        </select></div>
      </>}
      {kind === "compound" && <div><label className="flab">Rincian</label><select className="fi" name="rincian" defaultValue={reconciliationView ? "rekonsiliasi" : ingredientView ? "bahan" : "margin"}>
        <option value="margin">Margin per racikan</option><option value="bahan">Bahan dan HPP historis</option><option value="rekonsiliasi">Perlu rekonsiliasi tautan / HPP</option>
      </select></div>}
      {kind === "compound" && <div><label className="flab">Dokter kunjungan</label><select className="fi" name="dokter" defaultValue={filters.dokter}>
        <option value="">Semua dokter</option>{compound?.doctors.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}
      </select></div>}
      <div><label className="flab">Cari</label><input className="fi" name="q" defaultValue={filters.q} maxLength={120} placeholder={kind === "inventory" ? "Barang / kode / gudang" : "Racikan / invoice / dokter"} /></div>
      <button className="btn-def" type="submit"><i className="ti ti-filter" /> Tampilkan</button>
    </>}
    ringkasan={report ? <KartuAngka items={cards} /> : undefined}
  >
    {message ? <div className="p2ban" style={{ color: "#b91c1c" }}>{message}</div> : table && report ? <div className="crm-sec">
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: "var(--td)" }}>Dibaca {reportWIB(report.readAt)} WIB</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn-def" href={`${path}/unduh?${query}`}><i className="ti ti-download" /> CSV ({table.rows.length} baris)</Link>
          <Link className="btn-def" href={`${path}/unduh?${query}&format=xlsx`}>Excel lengkap</Link>
          <a className="btn-def" href={`${path}/unduh?${query}&format=print`} target="_blank" rel="noopener noreferrer">Cetak / PDF lengkap</a>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}><table className="tbl" style={{ width: "100%", minWidth: 1600 }}>
        <thead><tr>{table.columns.map(column => <th key={column.label} style={{ textAlign: column.format ? "right" : "left" }}>{column.label}</th>)}</tr></thead>
        <tbody>{pagination.rows.map(row => <tr key={row.id}>{row.cells.map((value,index) => <td key={index} style={{ textAlign: table.columns[index].format ? "right" : "left", whiteSpace: table.columns[index].format ? "nowrap" : undefined }}>
          {row.href && index === 1 ? <Link href={row.href}>{cellText(value,table.columns[index])}</Link> : cellText(value,table.columns[index])}
        </td>)}</tr>)}
        {pagination.rows.length === 0 && <TabelKosong kolom={table.columns.length} pesan="Belum ada data untuk pilihan ini." />}</tbody>
      </table></div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: 11 }}>
        <span>Halaman {pagination.page} dari {pagination.pages} · Ringkasan mencakup semua {table.rows.length} baris.</span>
        <div style={{ display: "flex", gap: 8 }}>
          {pagination.page > 1 && <Link className="btn-def" href={pageHref(pagination.page-1)}>Sebelumnya</Link>}
          {pagination.page < pagination.pages && <Link className="btn-def" href={pageHref(pagination.page+1)}>Berikutnya</Link>}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--td)", marginTop: 14, lineHeight: 1.7 }}>
        {inventory ? <>
          Subtotal ber-HPP hanya menjumlahkan lapisan dengan harga pokok positif. Nilai lengkap dan HPP rata-rata ditampilkan setelah seluruh qty tercakup dan saldo stok cocok dengan lapisan.
          Lapisan kadaluarsa tetap bernilai. Selisih dapat berasal dari histori stok atau perubahan selama pembacaan; laporan ini tidak memperbaiki saldo dan tidak merekonstruksi tanggal lampau.
        </> : compound ? <>
          Penjualan memakai tanggal invoice dan diskon per item, termasuk invoice belum lunas. Diskon tingkat invoice dan pajak belum dialokasikan, sehingga jumlah ini bisa berbeda dari total pembayaran.
          Laba dan margin ringkasan hanya memakai penjualan yang HPP-nya tersedia ({money(compound.summary.coveredRevenue)} dari {money(compound.summary.revenue)}).
          Dokter mengikuti penanggung jawab kunjungan saat ini. Versi resmi tetap memakai ID saat racikan dibuat; metadata versi nonaktif dapat tidak tersedia.
          Nama dan satuan bahan mengikuti resep saat dibaca; label racikan ad hoc dapat berubah. Qty resep yang tidak valid ditampilkan kosong tanpa mengubah HPP invoice.
          Rincian bahan memakai HPP pemakaian historis yang ditautkan ke invoice. Jika histori belum tersedia, qty berasal dari resep tersimpan dan HPP bahan ditandai belum tersedia. Qty resep lama dapat berubah; nilai bahan tidak dihitung dari harga jual atau HPP stok saat ini.
          Hanya baris dengan tautan ID resep yang dihitung. Rincian rekonsiliasi menampilkan racikan tanpa tautan resep atau HPP historis, dengan ID sumber dan alasan. Baris obat lama tanpa tautan barang/resep juga perlu diperiksa jika kunjungannya memiliki catatan racikan; ini belum membuktikan baris tersebut adalah racikan. Baris tanpa tautan tidak masuk total keuangan; HPP, laba, dan margin yang tidak diketahui tetap kosong. Tautan tidak dicocokkan lewat nama.
        </> : null}
      </div>
    </div> : null}
  </LaporanPage>;
}
