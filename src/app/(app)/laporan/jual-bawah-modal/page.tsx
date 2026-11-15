import Link from "next/link";
import { KartuAngka, LaporanPage, TabelKosong } from "@/components/LaporanPage";
import { laporanDiminta } from "@/lib/report-gate";
import {
  HALAMAN_BAWAH_MODAL, muatBawahModal, muatCabangLaporan, periksaAksesBawahModal, rentangBawahModal, totalRugi, type BarisBawahModal,
} from "@/lib/jual-bawah-modal-server";
import { createClient } from "@/lib/supabase/server";

const rp = (n: number) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");

export default async function JualBawahModalPage({ searchParams }: { searchParams: Promise<{ dari?: string; sampai?: string; cabang?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  if (!(await periksaAksesBawahModal(supabase))) {
    return <div className="p2ban" role="alert">Halaman ini belum diizinkan untuk akun Anda. Minta Owner mencentangnya di Akses Grup (hanya Owner, Admin, dan Finance).</div>;
  }
  const siap = laporanDiminta(sp);
  const { dari, sampai } = rentangBawahModal(sp);
  let cabangOpsi: { id: string; name: string }[] = [];
  let galat = "";
  try { cabangOpsi = await muatCabangLaporan(supabase); } catch (e) { galat = e instanceof Error ? e.message : "Pilihan cabang belum dapat dimuat."; }
  const cabang = cabangOpsi.some((c) => c.id === sp.cabang) ? String(sp.cabang) : "";
  let baris: BarisBawahModal[] = [];
  if (siap && !galat) {
    try { baris = await muatBawahModal(supabase, dari, sampai, cabang); } catch (e) { galat = e instanceof Error ? e.message : "Laporan belum dapat dimuat."; }
  }
  const unduh = `${HALAMAN_BAWAH_MODAL}/unduh?${new URLSearchParams({ dari, sampai, cabang })}`;
  return (
    <LaporanPage
      siap={siap} unduhTampilan={false}
      icon="ti-discount-2" title="PENJUALAN DI BAWAH MODAL (OBRAL)"
      desc="Barang persediaan yang dijual di bawah HPP oleh Owner atau peran berizin, dengan alasan. Struk aktif saja (yang dibatalkan/diubah tidak dihitung dua kali)."
      filter={<>
        <div><label className="flab">Dari tanggal</label><input className="fi" type="date" name="dari" defaultValue={dari} /></div>
        <div><label className="flab">Sampai tanggal</label><input className="fi" type="date" name="sampai" defaultValue={sampai} /></div>
        <div><label className="flab">Cabang</label>
          <select className="fi" name="cabang" defaultValue={cabang}><option value="">Semua cabang</option>
            {cabangOpsi.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <button className="btn-def" type="submit"><i className="ti ti-filter" /> Tampilkan</button>
      </>}
      ringkasan={siap && !galat ? <KartuAngka items={[
        { label: "Baris obral", nilai: baris.length.toLocaleString("id-ID") },
        { label: "Total rugi (HPP - harga neto)", nilai: rp(totalRugi(baris)), warna: "#b91c1c" },
      ]} /> : undefined}
    >
      {galat ? <div className="p2ban" role="alert" style={{ color: "#b91c1c" }}>{galat}</div> : <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <Link className="btn-def" href={unduh}><i className="ti ti-file-spreadsheet" /> Unduh Excel ({baris.length} baris)</Link>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 980, width: "100%" }}>
            <thead><tr>
              <th>Tanggal</th><th>Cabang</th><th>Struk</th><th>Barang</th><th style={{ textAlign: "right" }}>Qty</th>
              <th style={{ textAlign: "right" }}>HPP</th><th style={{ textAlign: "right" }}>Harga neto</th><th style={{ textAlign: "right" }}>Rugi</th><th>Alasan</th><th>Oleh</th>
            </tr></thead>
            <tbody>
              {baris.map((b) => <tr key={`${b.sale_id}:${b.item_id}:${b.no_struk}:${b.qty}:${b.harga_neto}`}>
                <td style={{ fontSize: 11 }}>{b.tanggal}</td><td style={{ fontSize: 11 }}>{b.cabang ?? "-"}</td>
                <td style={{ fontSize: 11 }}><Link href={`/kasir/struk/${b.sale_id}`}>{b.no_struk}</Link></td>
                <td style={{ fontSize: 11 }}><span style={{ fontFamily: "var(--mono, monospace)", fontSize: 10, color: "var(--tm)" }}>{b.kode}</span> {b.barang}</td>
                <td style={{ textAlign: "right", fontSize: 11 }}>{b.qty} <span style={{ fontSize: 9, color: "var(--td)" }}>{b.satuan}</span></td>
                <td style={{ textAlign: "right", fontSize: 11 }}>{rp(b.hpp)}</td><td style={{ textAlign: "right", fontSize: 11 }}>{rp(b.harga_neto)}</td>
                <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700, color: "#b91c1c" }}>{rp(b.rugi)}</td>
                <td style={{ fontSize: 11 }}>{b.alasan}</td><td style={{ fontSize: 11 }}>{b.oleh}</td>
              </tr>)}
              {baris.length === 0 && <TabelKosong kolom={10} pesan="Tidak ada penjualan di bawah modal pada rentang ini." />}
            </tbody>
          </table>
        </div>
      </div>}
    </LaporanPage>
  );
}
