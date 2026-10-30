import Link from "next/link";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { hariIniWIB } from "@/lib/tanggal";
import { ambilPenjualanBarang, waktuWIB } from "./data";
import { normalizeReportColumns } from "@/lib/report-columns";
import { jenisLaporan, SEMUA_JENIS_KLINIK } from "@/lib/laporan-penjualan-barang";
import { KANAL_SEMUA, type Kanal } from "@/lib/laporan-transaksi";

const rupiah = (value: number) => `Rp ${Math.round(value).toLocaleString("id-ID")}`;
const UKURAN_HALAMAN_TAMPILAN = 100;

export default async function LaporanPenjualanBarangPage({ searchParams }: {
  searchParams: Promise<{ dari?: string; sampai?: string; kanal?: string; jenis?: string; q?: string; cabang_id?: string; pelaksana_id?: string; kolom?: string; halaman?: string }>;
}) {
  const sp = await searchParams;
  const hariIni = hariIniWIB();
  const dari = sp.dari || `${hariIni.slice(0, 8)}01`;
  const sampai = sp.sampai || hariIni;
  const kanal = (KANAL_SEMUA as string[]).includes(sp.kanal ?? "") ? sp.kanal! : "Klinik";
  const jenis = jenisLaporan(kanal, sp.jenis);
  const q = (sp.q ?? "").trim().slice(0, 120);
  const cabangId = (sp.cabang_id ?? "").slice(0, 80);
  const pelaksanaId = (sp.pelaksana_id ?? "").slice(0, 80);
  const halamanDiminta = Number(sp.halaman);
  const halaman = Number.isSafeInteger(halamanDiminta) && halamanDiminta > 0 ? halamanDiminta : 1;
  let kolom = "";
  try { kolom = normalizeReportColumns(sp.kolom ?? null); } catch { /* Invalid URL choices stay visible in the column editor. */ }
  const { rows: terpilih, cabangOptions, pelaksanaOptions = [], pesanError, nilaiTotal, qtyTotal } = await ambilPenjualanBarang({
    dari, sampai, kanal: kanal as Kanal, jenis, q, cabangId, pelaksanaId,
  });
  const banyakHalaman = Math.max(1, Math.ceil(terpilih.length / UKURAN_HALAMAN_TAMPILAN));
  const halamanAktif = Math.min(halaman, banyakHalaman);
  const terlihat = terpilih.slice((halamanAktif - 1) * UKURAN_HALAMAN_TAMPILAN, halamanAktif * UKURAN_HALAMAN_TAMPILAN);
  const tautanHalaman = (nomor: number) => {
    const params = new URLSearchParams({ dari, sampai, kanal, jenis, q, cabang_id: cabangId, pelaksana_id: pelaksanaId, halaman: String(nomor) });
    if (kolom) params.set("kolom", kolom);
    return `/laporan/penjualan-barang?${params}`;
  };
  const csvParams = new URLSearchParams({ dari, sampai, kanal, jenis, q, cabang_id: cabangId, pelaksana_id: pelaksanaId });

  return (
    <LaporanPage
      unduhTampilan={false}
      pilihKolom
      icon="ti-list-details" title="RINCIAN PENJUALAN PER BARANG"
      desc="Setiap barang, obat, jasa, dan racikan yang tercatat pada struk, invoice klinik, atau faktur penjualan grosir. Bawaan: racikan klinik bulan ini."
      filter={<>
        <div><label className="flab">Dari tanggal</label><input className="fi" type="date" name="dari" defaultValue={dari} /></div>
        <div><label className="flab">Sampai tanggal</label><input className="fi" type="date" name="sampai" defaultValue={sampai} /></div>
        <div><label className="flab">Sumber</label><select className="fi" name="kanal" defaultValue={kanal}>
          <option value="Klinik">Klinik</option><option value="POS">Kasir</option><option value="Online">Online</option>
          <option value="Grosir">Grosir (Faktur Penjualan)</option>
        </select></div>
        <div><label className="flab">Cabang</label><select className="fi" name="cabang_id" defaultValue={cabangId}>
          <option value="">Semua cabang yang dapat diakses</option>
          {cabangId && !cabangOptions.some(branch => branch.id === cabangId) && <option value={cabangId}>Cabang tidak ada pada data · {cabangId.slice(0, 8)}</option>}
          {cabangOptions.map(branch => <option key={branch.id} value={branch.id}>{branch.name} · {branch.id.slice(0, 8)}</option>)}
        </select></div>
        <div><label className="flab">Jenis</label><select className="fi" name="jenis" defaultValue={jenis}>
          {kanal === "Klinik" ? <>
            <option value="Racikan">Racikan</option><option value="Obat">Obat lain</option>
            <option value={SEMUA_JENIS_KLINIK}>Semua baris invoice klinik</option>
            <option value="Jasa">Jasa/tindakan</option><option value="Biaya Admin">Biaya admin DEMO</option>
          </> : <option value="Barang">{kanal === "Grosir" ? "Barang faktur grosir" : "Barang kasir/online"}</option>}
        </select></div>
        <div><label className="flab">Pelaksana tersimpan</label><select className="fi" name="pelaksana_id" defaultValue={pelaksanaId}>
          <option value="">Semua pelaksana</option>
          {pelaksanaId && !pelaksanaOptions.some(person => person.id === pelaksanaId) && <option value={pelaksanaId}>Pelaksana tidak ada pada data · {pelaksanaId.slice(0, 8)}</option>}
          {pelaksanaOptions.map(person => <option key={person.id} value={person.id}>{person.nama} · {person.id.slice(-8)}</option>)}
        </select></div>
        <div><label className="flab">Cari nama / invoice / pelanggan / pelaksana</label><input className="fi" name="q" defaultValue={q} placeholder="Mis. puyer" style={{ minWidth: 190 }} /></div>
        <button className="btn-def" type="submit"><i className="ti ti-filter" /> Tampilkan</button>
      </>}
      ringkasan={!pesanError ? <KartuAngka items={[
        { label: "Baris penjualan", nilai: terpilih.length.toLocaleString("id-ID") },
        { label: "Jumlah terjual", nilai: qtyTotal.toLocaleString("id-ID", { maximumFractionDigits: 2 }) },
        { label: kanal === "POS" ? "Neto barang sebelum retur dan fee" : kanal === "Klinik" || kanal === "Grosir" ? "Neto baris sebelum pajak" : "Nilai setelah diskon item", nilai: rupiah(nilaiTotal), warna: "#15803d" },
      ]} /> : undefined}
    >
      {pesanError ? <div className="p2ban" style={{ color: "#b91c1c" }}>{pesanError}</div> : <>
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <span style={{ fontSize: 10.5, color: "var(--tm)", alignSelf: "center" }}>Pilihan kolom berlaku di layar; berkas unduh tetap lengkap untuk payroll.</span>
            <Link className="btn-def" href={`/laporan/penjualan-barang/unduh?${csvParams}`}>
              <i className="ti ti-download" /> Unduh CSV ({terpilih.length} baris)
            </Link>
            <Link className="btn-def" href={`/laporan/penjualan-barang/unduh?${csvParams}&format=xlsx`}>Excel lengkap</Link>
            <a className="btn-def" href={`/laporan/penjualan-barang/unduh?${csvParams}&format=print`} target="_blank" rel="noopener noreferrer">Cetak / PDF lengkap</a>
          </div>
          <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 1350, width: "100%" }}>
            <thead><tr>
              <th>Waktu</th><th>No. dokumen</th><th>Cabang</th><th>Pelanggan / pasien</th><th>Barang / layanan</th><th>Pelaksana tersimpan</th>
              <th style={{ textAlign: "right" }}>Qty</th><th style={{ textAlign: "right" }}>Harga</th>
              <th style={{ textAlign: "right" }}>{kanal === "Online" || kanal === "Grosir" ? "Diskon item" : "Potongan / pembulatan"}</th><th style={{ textAlign: "right" }}>Nilai baris</th>
            </tr></thead>
            <tbody>
              {terlihat.map((row) => <tr key={row.id} style={row.indukId ? { background: "var(--sf1)" } : undefined}>
                <td style={{ whiteSpace: "nowrap", fontSize: 10.5 }}>{row.indukId ? "" : waktuWIB(row.waktu)}</td>
                <td>{row.indukId ? "" : <Link href={row.href} style={{ color: "#2563eb", fontWeight: 700 }}>{row.dokumen}</Link>}</td>
                <td>{row.indukId ? "" : row.cabang}</td><td>{row.indukId ? "" : <>{row.pelanggan}{row.hewan !== "—" && <div style={{ color: "var(--td)" }}>Pasien: {row.hewan}</div>}</>}</td>
                {/* Baris anak = BMHP tindakan: hanya jumlah, satuan dan HPP-nya; nilai jualnya nol. */}
                <td style={{ fontWeight: row.indukId ? 400 : 600, paddingLeft: row.indukId ? 24 : undefined }}>{row.nama}
                  <div style={{ fontSize: 9.5, fontWeight: 400, color: "var(--td)" }}>
                    {row.indukId
                      ? `BMHP tindakan · HPP ${rupiah(row.hpp ?? 0)}`
                      : `${row.jenis}${row.status !== "—" ? ` · ${row.status}` : ""}${row.kanal === "Grosir" ? ` · HPP ${row.hpp == null ? "belum tercatat" : rupiah(row.hpp)}` : ""}`}
                  </div></td>
                <td>{row.indukId ? "" : row.pelaksana}</td>
                <td style={{ textAlign: "right" }}>{row.qty.toLocaleString("id-ID", { maximumFractionDigits: 2 })}{row.satuan ? ` ${row.satuan}` : ""}</td>
                <td style={{ textAlign: "right" }}>{row.indukId ? "—" : rupiah(row.harga)}</td>
                <td style={{ textAlign: "right" }}>{row.diskon ? rupiah(row.diskon) : "—"}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{rupiah(row.nilai)}</td>
              </tr>)}
              {terlihat.length === 0 && <TabelKosong kolom={10} pesan="Belum ada penjualan untuk pilihan ini." />}
            </tbody>
          </table></div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", marginTop: 12, fontSize: 11 }}>
            <span>Halaman {halamanAktif} dari {banyakHalaman}</span>
            <div style={{ display: "flex", gap: 8 }}>
              {halamanAktif > 1 && <Link className="btn-def" href={tautanHalaman(halamanAktif - 1)}>Sebelumnya</Link>}
              {halamanAktif < banyakHalaman && <Link className="btn-def" href={tautanHalaman(halamanAktif + 1)}>Berikutnya</Link>}
            </div>
          </div>
          <div style={{ fontSize: 10, color: "var(--td)", marginTop: 12 }}>
            {kanal === "Grosir"
              ? "Nilai baris faktur grosir = qty × harga − diskon baris, yaitu dasar DPP sebelum PPN; jumlah seluruh barisnya sama dengan DPP fakturnya. Faktur dihitung pada tanggal fakturnya (jam ditampilkan 00.00 karena faktur hanya menyimpan tanggal) dan ikut sejak terbit walau belum dibayar. Faktur batal, faktur yang sudah diganti faktur koreksi, faktur saldo awal, dan faktur selisih stok opname tidak ikut. HPP grosir diakui di dokumen Pengiriman; baris tanpa pengiriman ditampilkan \"belum tercatat\"."
              : kanal === "POS"
              ? "Neto POS dibagi ke tiap barang dari total struk sebelum fee merchant, termasuk diskon nota, voucher, poin, dan pembulatan. Selisih pembulatan bisa bernilai negatif. Retur kasir belum dialokasikan ke baris; total setelah retur dapat berbeda."
              : kanal === "Klinik"
                ? "Neto invoice klinik dibagi ke tiap baris setelah diskon invoice, termasuk promo, voucher, poin, dan pembulatan; pajak dan pembayaran DP tidak masuk nilai baris. Selisih pembulatan bisa bernilai negatif."
                : "Nilai baris sudah memperhitungkan diskon per barang. Diskon tingkat nota, retur, dan pajak belum dibagi ke tiap baris; total bisa berbeda dari pembayaran."}
            {" "}BMHP tindakan klinik tampil sebagai baris anak dengan nilai nol; biayanya sudah masuk HPP baris tindakan, jadi omzet tidak dihitung dua kali.
            {" "}Racikan dicocokkan dengan resep pada kunjungan yang sama. Filter pelaksana memakai ID yang tersimpan pada baris jasa; baris dengan dokter dan pelaksana muncul pada filter masing-masing, tetapi omzet cabang menghitung baris itu sekali. Ini laporan penjualan, bukan total insentif.
          </div>
        </div>
      </>}
    </LaporanPage>
  );
}
