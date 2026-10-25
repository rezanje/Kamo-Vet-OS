import Link from "next/link";
import { redirect } from "next/navigation";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { ListLoadFailure } from "@/components/ListPagination";
import { createClient } from "@/lib/supabase/server";
import { paginateReport } from "@/lib/hpp-reports";
import { loadOpnamePriceReport, opnameFilters, OPNAME_REPORT_PATH, type OpnameReportParams } from "@/lib/opname-price-report";
import { ReportAccessError } from "@/lib/hpp-reports-server";
import Decimal from "decimal.js";

const qty = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 8 });
const money = (v: string | null) => {
  if (v === null) return "Tidak tersedia";
  const number = new Decimal(v).toDecimalPlaces(4).toFixed(4);
  const [whole, decimal] = number.replace(/^-/, "").split(".");
  return `${number.startsWith("-") ? "−" : ""}Rp ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${decimal.replace(/0+$/, "").padEnd(2, "0")}`;
};

export default async function Page({ searchParams }: { searchParams: Promise<OpnameReportParams> }) {
  const input = await searchParams;
  let report: Awaited<ReturnType<typeof loadOpnamePriceReport>> | null = null;
  let error: unknown = null;
  try { report = await loadOpnamePriceReport(await createClient(), input); }
  catch (caught) { error = caught; }
  if (error instanceof ReportAccessError && error.status === 401) redirect("/login");
  if (error instanceof ReportAccessError && error.status === 403) redirect("/laporan");
  let filters: ReturnType<typeof opnameFilters> | null = null;
  try { filters = report?.filters ?? opnameFilters(input); } catch { /* invalid dates appear below */ }
  const query = (extra: Record<string, string>) => `${OPNAME_REPORT_PATH}?${new URLSearchParams({
    dari: filters?.dari ?? "", sampai: filters?.sampai ?? "", cabang: filters?.cabang ?? "",
    order: filters?.order ?? "", dasar: filters?.dasar ?? "modal", arah: filters?.arah ?? "semua", ...extra,
  })}`;
  const selected = report?.selected;
  const page = paginateReport(report?.entries ?? [], input.halaman);
  const sum = report && selected && !report.legacy ? [
    { label: "Baris sesuai filter", nilai: String(report.shown.length) },
    { label: "Nilai selisih lebih", nilai: money(report.plus) },
    { label: "Nilai selisih kurang", nilai: money(report.minus) },
    { label: "Neto selisih", nilai: money(report.net) },
    { label: "Tanpa nilai modal", nilai: String(report.unavailable) },
  ] : [];
  return <LaporanPage icon="ti-clipboard-check" title="HASIL STOK OPNAME"
    desc="Snapshot harga saat hasil diposting. Harga jual cabang untuk laporan bukan dasar jurnal atau faktur selisih."
    unduhTampilan={false}
    filter={<>
      <div><label className="flab">Dari tanggal</label><input className="fi" name="dari" type="date" defaultValue={filters?.dari} /></div>
      <div><label className="flab">Sampai tanggal</label><input className="fi" name="sampai" type="date" defaultValue={filters?.sampai} /></div>
      <div><label className="flab">Cabang</label><select className="fi" name="cabang" defaultValue={filters?.cabang ?? ""}>
        <option value="">Semua cabang yang diizinkan</option>
        {report?.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></div>
      <button className="btn bp" type="submit">Terapkan</button>
    </>}
    ringkasan={sum.length ? <KartuAngka items={sum} /> : undefined}>
    {error ? <ListLoadFailure error={error} label="Laporan hasil stok opname" /> : <>
      {selected && <div className="p2ban" style={{ marginBottom: 12 }}>
        <strong>{selected.resultNo}</strong> · {selected.branch} · {selected.warehouse} · {selected.date} · {report?.scope ?? "Cakupan belum tersedia"}.
        <Link href={`/pos/opname/${encodeURIComponent(selected.orderId)}`} style={{ marginLeft: 12 }}>Buka perintah asal</Link>
        {report?.revision && <div>Angka harga ini berasal dari posting awal. Koreksi stok revisi {report.revision} tidak mengubah snapshot ini.</div>}
      </div>}
      {report?.legacy && <div className="p2ban" role="status">Hasil lama ini tidak mempunyai snapshot harga saat posting. Harga historis tidak tersedia.</div>}
      {selected && !report?.legacy && <div className="crm-sec">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <Link className="btn" href={query({ dasar: "modal" })}>Modal FIFO</Link>
          <Link className="btn" href={query({ dasar: "jual" })}>Harga jual cabang</Link>
          <span style={{ fontSize: 11 }}>Dasar aktif: <b>{filters?.dasar === "jual" ? "harga jual cabang" : "modal FIFO"}</b></span>
          <span className="flab">Selisih:</span>
          {(["semua", "lebih", "kurang", "sama"] as const).map(arah => <Link key={arah} href={query({ arah })}>{arah === "semua" ? "Semua" : arah === "lebih" ? "Lebih" : arah === "kurang" ? "Kurang" : "Sama"}</Link>)}
          <Link className="btn" href={`${OPNAME_REPORT_PATH}/unduh?${new URLSearchParams({ ...filters!, format: "csv" })}`}>Unduh CSV</Link>
          <Link className="btn" href={`${OPNAME_REPORT_PATH}/unduh?${new URLSearchParams({ ...filters!, format: "xlsx" })}`}>Unduh Excel</Link>
        </div>
        <div className="p2ban" style={{ marginBottom: 12 }}>
          {report?.method === "fifo" ? "Modal satuan untuk selisih kurang adalah HPP FIFO keluar per unit; untuk selisih lebih adalah biaya masuk/acuan PO per unit. Keduanya cocok dengan nilai selisih yang dijurnal. Barang tanpa selisih memakai rata-rata nilai lapisan setelah posting." : "Metode average aktif pada dokumen ini; modal FIFO tidak tersedia. Harga jual cabang tetap tersimpan sebagai referensi."}
        </div>
        <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 980 }}><thead><tr>
          <th>Kode</th><th>Barang</th><th>Satuan</th><th>Sistem</th><th>Fisik</th><th>Selisih</th>
          <th>{filters?.dasar === "jual" ? "Harga jual cabang" : "Modal satuan"}</th><th>Nilai selisih</th><th>Sumber modal</th>
        </tr></thead><tbody>
          {report?.shown.map(row => <tr key={row.itemId}>
            <td>{row.code}</td><td>{row.name}</td><td>{row.unit}</td>
            <td style={{ textAlign: "right" }}>{qty(row.systemQty)}</td><td style={{ textAlign: "right" }}>{qty(row.physicalQty)}</td>
            <td style={{ textAlign: "right" }}>{row.difference > 0 ? "+" : ""}{qty(row.difference)}</td>
            <td style={{ textAlign: "right" }}>{money(filters?.dasar === "jual" ? row.branchPrice : row.unitCost)}</td>
            <td style={{ textAlign: "right" }}>{money(filters?.dasar === "jual" ? row.saleDifference : row.modalDifference)}</td>
            <td>{filters?.dasar === "jual" ? "Referensi cabang saat posting" : row.modalDifferenceSource}</td>
          </tr>)}
          {!report?.shown.length && <TabelKosong kolom={9} pesan="Tidak ada baris untuk filter ini." />}
        </tbody></table></div>
      </div>}
      <div className="crm-sec"><h3 style={{ marginTop: 0 }}>Hasil dalam periode</h3>
        <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 650 }}><thead><tr>
          <th>Hasil</th><th>Perintah</th><th>Tanggal</th><th>Cabang</th><th>Gudang</th><th>Detail</th>
        </tr></thead><tbody>
          {page.rows.map(row => <tr key={row.resultId}>
            <td>{row.resultNo}</td><td>{row.orderNo}</td><td>{row.date}</td><td>{row.branch}</td><td>{row.warehouse}</td>
            <td><Link href={query({ order: row.orderId })}>Lihat laporan</Link></td>
          </tr>)}
          {!page.rows.length && <TabelKosong kolom={6} pesan="Belum ada hasil opname pada periode dan cabang terpilih." />}
        </tbody></table></div>
        {page.pages > 1 && <div style={{ marginTop: 10 }}>Halaman {page.page} dari {page.pages}. {page.page > 1 && <Link href={query({ halaman: String(page.page - 1) })}>Sebelumnya</Link>} {page.page < page.pages && <Link href={query({ halaman: String(page.page + 1) })}>Berikutnya</Link>}</div>}
      </div>
    </>}
  </LaporanPage>;
}
