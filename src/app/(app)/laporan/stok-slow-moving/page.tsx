import Link from "next/link";
import { KartuAngka, LaporanPage, TabelKosong } from "@/components/LaporanPage";
import { CatatanRiwayat } from "@/components/KartuStok";
import { Definisi, FilterStok, NomorHalaman, UKURAN_HALAMAN_STOK, halamanDari } from "@/components/StokLaporanBagian";
import { laporanDiminta } from "@/lib/report-gate";
import {
  daftarSlow, hitungPortofolio, KONFIG_STOK, labelRiwayat, LABEL_STATUS, ringkasSlow, rupiah, saring, tampilBulan, tampilQty,
  HALAMAN_SLOW, tanggalId, type StatusStok,
} from "@/lib/stok-analisis";
import { muatPilihanStok, muatRingkasStok, periksaAksesStok, StokAnalisisError } from "@/lib/stok-analisis-server";
import { createClient } from "@/lib/supabase/server";

const WARNA: Record<StatusStok, string> = { mati: "#b91c1c", tidak_laku: "#c2410c", belum_laku: "#0369a1", berlebih: "#b45309", aman: "#15803d" };

export default async function StokSlowMovingPage({ searchParams }: {
  searchParams: Promise<{ gudang?: string; kategori?: string; q?: string; halaman?: string; tampil?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const akses = await periksaAksesStok(supabase, HALAMAN_SLOW);
  if (!akses.ok) return <div className="p2ban" role="alert">Halaman ini belum diizinkan untuk akun Anda. Minta Owner mencentangnya di Akses Grup.</div>;

  const siap = laporanDiminta(sp);
  const q = (sp.q ?? "").trim().slice(0, 120);
  const kategori = (sp.kategori ?? "").trim().toLocaleUpperCase("id-ID").slice(0, 80);
  let pilihan, galat = "";
  try { pilihan = await muatPilihanStok(supabase); } catch { pilihan = null; galat = "Pilihan filter belum dapat dimuat. Muat ulang."; }
  const gudangId = pilihan?.gudang.some((w) => w.id === sp.gudang) ? String(sp.gudang) : "";

  let hasil = null;
  if (siap && pilihan) {
    try { hasil = await muatRingkasStok(supabase, gudangId); }
    catch (e) { galat = e instanceof StokAnalisisError ? e.message : "Data stok belum dapat dihitung. Muat ulang sebentar lagi."; }
  }
  const semua = hasil ? daftarSlow(hasil.baris) : [];
  const tersaring = pilihan ? saring(semua, { q, kategori, kategoriDari: pilihan.kategoriDari }) : [];
  const ringkas = ringkasSlow(tersaring);
  const portofolio = hasil ? hitungPortofolio(hasil.baris) : null;
  const halaman = Math.min(halamanDari(sp.halaman), Math.max(1, Math.ceil(tersaring.length / UKURAN_HALAMAN_STOK)));
  const terlihat = tersaring.slice((halaman - 1) * UKURAN_HALAMAN_STOK, halaman * UKURAN_HALAMAN_STOK);
  const params = { gudang: gudangId, kategori, q };
  const unduh = `/laporan/stok-slow-moving/unduh?${new URLSearchParams(params)}`;
  const label = hasil ? labelRiwayat(hasil.ctx) : "";

  return (
    <LaporanPage
      siap={siap}
      unduhTampilan={false}
      icon="ti-snowflake" title="STOK SLOW MOVING / BERLEBIH"
      desc="Barang yang stoknya terlalu banyak dibanding penjualannya. Dari riwayat penjualan, semua gudang digabung."
      filter={pilihan ? <FilterStok gudang={pilihan.gudang} gudangId={gudangId} kategoriOpsi={pilihan.kategoriOpsi} kategori={kategori} q={q} /> : undefined}
      ringkasan={hasil && portofolio ? <>
        <KartuAngka items={[
          { label: "Barang slow moving", nilai: ringkas.jumlah.toLocaleString("id-ID") },
          { label: "Modal tertahan", nilai: rupiah(ringkas.modalTertahan), warna: "#b45309" },
          { label: "Nilai stok semua barang", nilai: rupiah(portofolio.nilaiStok) },
          { label: "Semua stok cukup untuk", nilai: `${tampilBulan(portofolio.coverBulan)} bulan`, warna: portofolio.berlebih ? "#b91c1c" : "#15803d" },
        ]} />
        <CatatanRiwayat label={label} baru={hasil.ctx.riwayatBaru} />
      </> : undefined}
    >
      {galat ? <div className="p2ban" role="alert" style={{ color: "#b91c1c" }}>{galat}</div> : <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 10 }}>
          <Link className="btn-def" href={unduh}><i className="ti ti-file-spreadsheet" /> Unduh Excel ({tersaring.length} barang)</Link>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 880, width: "100%" }}>
            <thead><tr>
              <th>Barang</th><th style={{ textAlign: "right" }}>Stok</th><th style={{ textAlign: "right" }}>Terjual/bulan</th>
              <th style={{ textAlign: "right" }}>Cukup untuk (bulan)</th><th>Terakhir laku</th>
              <th style={{ textAlign: "right" }}>Nilai stok</th><th style={{ textAlign: "right" }}>Modal tertahan</th><th>Status</th>
            </tr></thead>
            <tbody>
              {terlihat.map((b) => <tr key={b.id}>
                <td style={{ fontSize: 11 }}><span style={{ fontFamily: "var(--mono, monospace)", fontSize: 10, color: "var(--tm)" }}>{b.kode}</span> {b.nama}</td>
                <td style={{ textAlign: "right", fontSize: 11 }}>{tampilQty(b.stok)} <span style={{ fontSize: 9, color: "var(--td)" }}>{b.satuan}</span></td>
                <td style={{ textAlign: "right", fontSize: 11 }}>{tampilQty(b.terjualBulan)}</td>
                <td style={{ textAlign: "right", fontSize: 11 }}>{tampilBulan(b.coverBulan)}</td>
                <td style={{ fontSize: 11 }}>{tanggalId(b.terakhirLaku)}</td>
                <td style={{ textAlign: "right", fontSize: 11 }}>{rupiah(b.nilaiStok)}</td>
                <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>{rupiah(b.modalTertahan)}</td>
                <td style={{ fontSize: 11, color: WARNA[b.status], fontWeight: 600 }}>{LABEL_STATUS[b.status]}{b.sementara ? " (sementara)" : ""}</td>
              </tr>)}
              {terlihat.length === 0 && <TabelKosong kolom={8} pesan="Tidak ada barang slow moving untuk pilihan ini." />}
            </tbody>
          </table>
        </div>
        <NomorHalaman dasar={HALAMAN_SLOW} params={params} halaman={halaman} total={tersaring.length} />
        <Definisi>
          Terjual/bulan = barang keluar ({KONFIG_STOK.jendelaHari} hari terakhir, atau sejak ada penjualan) ÷ hari × {KONFIG_STOK.hariPerBulan}.
          Cukup untuk = stok ÷ terjual/bulan. Berlebih = cukup lebih dari {KONFIG_STOK.berlebihBulan} bulan; Tidak laku = tidak ada yang keluar
          {" "}{KONFIG_STOK.tidakLakuHari} hari; Mati = {KONFIG_STOK.matiHari} hari; Belum laku = belum ada yang keluar, riwayat masih pendek.
          Modal tertahan = nilai stok (FIFO) yang tidak terpakai: semua untuk tidak laku/mati, kelebihan di atas {KONFIG_STOK.berlebihBulan} bulan untuk berlebih.
          Penjualan = kasir, klinik (termasuk BMHP dan racikan), faktur grosir; struk batal dan retur dikurangkan.
        </Definisi>
      </div>}
    </LaporanPage>
  );
}
