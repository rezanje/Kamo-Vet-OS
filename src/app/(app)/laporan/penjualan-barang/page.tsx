import Link from "next/link";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { hariIniWIB } from "@/lib/tanggal";
import { ambilPenjualanBarang, waktuWIB } from "./data";

const rupiah = (value: number) => `Rp ${Math.round(value).toLocaleString("id-ID")}`;
const UKURAN_HALAMAN_TAMPILAN = 100;

export default async function LaporanPenjualanBarangPage({ searchParams }: {
  searchParams: Promise<{ dari?: string; sampai?: string; kanal?: string; jenis?: string; q?: string; halaman?: string }>;
}) {
  const sp = await searchParams;
  const hariIni = hariIniWIB();
  const dari = sp.dari || `${hariIni.slice(0, 8)}01`;
  const sampai = sp.sampai || hariIni;
  const kanal = ["POS", "Online", "Klinik"].includes(sp.kanal ?? "") ? sp.kanal! : "Klinik";
  const jenis = kanal === "Klinik" && ["Obat", "Jasa", "Racikan"].includes(sp.jenis ?? "") ? sp.jenis! : kanal === "Klinik" ? "Racikan" : "Barang";
  const q = (sp.q ?? "").trim().slice(0, 120);
  const halamanDiminta = Number(sp.halaman);
  const halaman = Number.isSafeInteger(halamanDiminta) && halamanDiminta > 0 ? halamanDiminta : 1;
  const { rows: terpilih, pesanError, nilaiTotal, qtyTotal } = await ambilPenjualanBarang({
    dari, sampai, kanal: kanal as "POS" | "Online" | "Klinik", jenis, q,
  });
  const banyakHalaman = Math.max(1, Math.ceil(terpilih.length / UKURAN_HALAMAN_TAMPILAN));
  const halamanAktif = Math.min(halaman, banyakHalaman);
  const terlihat = terpilih.slice((halamanAktif - 1) * UKURAN_HALAMAN_TAMPILAN, halamanAktif * UKURAN_HALAMAN_TAMPILAN);
  const tautanHalaman = (nomor: number) => {
    const params = new URLSearchParams({ dari, sampai, kanal, jenis, q, halaman: String(nomor) });
    return `/laporan/penjualan-barang?${params}`;
  };
  const csvParams = new URLSearchParams({ dari, sampai, kanal, jenis, q });

  return (
    <LaporanPage
      icon="ti-list-details" title="RINCIAN PENJUALAN PER BARANG"
      desc="Setiap barang, obat, jasa, dan racikan yang tercatat pada struk atau invoice. Bawaan: racikan klinik bulan ini."
      filter={<>
        <div><label className="flab">Dari tanggal</label><input className="fi" type="date" name="dari" defaultValue={dari} /></div>
        <div><label className="flab">Sampai tanggal</label><input className="fi" type="date" name="sampai" defaultValue={sampai} /></div>
        <div><label className="flab">Sumber</label><select className="fi" name="kanal" defaultValue={kanal}>
          <option value="Klinik">Klinik</option><option value="POS">Kasir</option><option value="Online">Online</option>
        </select></div>
        <div><label className="flab">Jenis</label><select className="fi" name="jenis" defaultValue={jenis}>
          {kanal === "Klinik" ? <>
            <option value="Racikan">Racikan</option><option value="Obat">Obat lain</option>
            <option value="Jasa">Jasa/tindakan</option>
          </> : <option value="Barang">Barang kasir/online</option>}
        </select></div>
        <div><label className="flab">Cari nama / invoice / pelanggan</label><input className="fi" name="q" defaultValue={q} placeholder="Mis. puyer" style={{ minWidth: 190 }} /></div>
        <button className="btn-def" type="submit"><i className="ti ti-filter" /> Tampilkan</button>
      </>}
      ringkasan={!pesanError ? <KartuAngka items={[
        { label: "Baris penjualan", nilai: terpilih.length.toLocaleString("id-ID") },
        { label: "Jumlah terjual", nilai: qtyTotal.toLocaleString("id-ID", { maximumFractionDigits: 2 }) },
        { label: "Nilai setelah diskon item", nilai: rupiah(nilaiTotal), warna: "#15803d" },
      ]} /> : undefined}
    >
      {pesanError ? <div className="p2ban" style={{ color: "#b91c1c" }}>{pesanError}</div> : <>
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <Link className="btn-def" href={`/laporan/penjualan-barang/unduh?${csvParams}`}>
              <i className="ti ti-download" /> Unduh CSV ({terpilih.length} baris)
            </Link>
          </div>
          <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 1200, width: "100%" }}>
            <thead><tr>
              <th>Waktu</th><th>No. dokumen</th><th>Cabang</th><th>Pelanggan / pasien</th><th>Barang / layanan</th>
              <th style={{ textAlign: "right" }}>Qty</th><th style={{ textAlign: "right" }}>Harga</th>
              <th style={{ textAlign: "right" }}>Diskon item</th><th style={{ textAlign: "right" }}>Nilai baris</th>
            </tr></thead>
            <tbody>
              {terlihat.map((row) => <tr key={row.id}>
                <td style={{ whiteSpace: "nowrap", fontSize: 10.5 }}>{waktuWIB(row.waktu)}</td>
                <td><Link href={row.href} style={{ color: "#2563eb", fontWeight: 700 }}>{row.dokumen}</Link></td>
                <td>{row.cabang}</td><td>{row.pelanggan}{row.hewan !== "—" && <div style={{ color: "var(--td)" }}>Pasien: {row.hewan}</div>}</td>
                <td style={{ fontWeight: 600 }}>{row.nama}<div style={{ fontSize: 9.5, fontWeight: 400, color: "var(--td)" }}>{row.jenis}{row.status !== "—" ? ` · ${row.status}` : ""}</div></td>
                <td style={{ textAlign: "right" }}>{row.qty.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</td>
                <td style={{ textAlign: "right" }}>{rupiah(row.harga)}</td>
                <td style={{ textAlign: "right" }}>{row.diskon ? rupiah(row.diskon) : "—"}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{rupiah(row.nilai)}</td>
              </tr>)}
              {terlihat.length === 0 && <TabelKosong kolom={9} pesan="Belum ada penjualan untuk pilihan ini." />}
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
            Nilai baris sudah memperhitungkan diskon per barang. Diskon tingkat nota, retur kasir, dan pajak tidak dibagi ke tiap baris;
            total di sini bisa berbeda dari total pembayaran. Racikan dicocokkan dengan resep pada kunjungan yang sama.
          </div>
        </div>
      </>}
    </LaporanPage>
  );
}
