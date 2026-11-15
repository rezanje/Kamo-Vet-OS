import Link from "next/link";
import { KartuAngka, LaporanPage, TabelKosong } from "@/components/LaporanPage";
import { CatatanRiwayat } from "@/components/KartuStok";
import { Definisi, FilterStok, halamanDari, NomorHalaman, UKURAN_HALAMAN_STOK } from "@/components/StokLaporanBagian";
import { bolehBukaPath } from "@/lib/akses";
import { laporanDiminta } from "@/lib/report-gate";
import {
  daftarHarusOrder, HALAMAN_ORDER, KONFIG_STOK, kelompokOrder, labelRiwayat, LABEL_ALASAN, rupiah, saring, tampilQty,
} from "@/lib/stok-analisis";
import { muatPendukungOrder, muatPilihanStok, muatRingkasStok, periksaAksesStok, StokAnalisisError } from "@/lib/stok-analisis-server";
import { createClient } from "@/lib/supabase/server";

export default async function StokHarusOrderPage({ searchParams }: {
  searchParams: Promise<{ gudang?: string; kategori?: string; q?: string; halaman?: string; tampil?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const akses = await periksaAksesStok(supabase, HALAMAN_ORDER);
  if (!akses.ok) return <div className="p2ban" role="alert">Halaman ini belum diizinkan untuk akun Anda. Minta Owner mencentangnya di Akses Grup.</div>;

  const siap = laporanDiminta(sp);
  const q = (sp.q ?? "").trim().slice(0, 120);
  const kategori = (sp.kategori ?? "").trim().toLocaleUpperCase("id-ID").slice(0, 80);
  let pilihan, galat = "";
  try { pilihan = await muatPilihanStok(supabase); } catch { pilihan = null; galat = "Pilihan filter belum dapat dimuat. Muat ulang."; }
  const gudangId = pilihan?.gudang.some((w) => w.id === sp.gudang) ? String(sp.gudang) : "";

  let hasil = null;
  let order: ReturnType<typeof daftarHarusOrder> = [];
  let tidakValid: string[] = [];
  if (siap && pilihan) {
    try {
      hasil = await muatRingkasStok(supabase, gudangId);
      const kandidat = saring(hasil.baris.filter((b) => b.aktif && b.alasanOrder.length > 0 && (b.minStock > 0 || b.terjualHari > 0)), { q, kategori, kategoriDari: pilihan.kategoriDari });
      const pend = await muatPendukungOrder(supabase, kandidat);
      tidakValid = pend.tidakValid;
      order = daftarHarusOrder(kandidat, pend.satuanBeli, pend.pemasok, hasil.ctx);
    } catch (e) { galat = e instanceof StokAnalisisError ? e.message : "Data stok belum dapat dihitung. Muat ulang sebentar lagi."; }
  }
  const grup = kelompokOrder(order);
  const nilaiTotal = order.reduce((a, o) => a + o.nilai, 0);
  const kosong = order.filter((o) => o.stok <= 0).length;
  // Halaman diiris per pemasok supaya satu pemasok tidak terpotong di tengah.
  const potongan: typeof grup[] = [];
  let sekarang: typeof grup = [], hitung = 0;
  for (const g of grup) {
    if (hitung > 0 && hitung + g.rows.length > UKURAN_HALAMAN_STOK) { potongan.push(sekarang); sekarang = []; hitung = 0; }
    sekarang.push(g); hitung += g.rows.length;
  }
  if (sekarang.length) potongan.push(sekarang);
  const halaman = Math.min(halamanDari(sp.halaman), Math.max(1, potongan.length));
  const terlihat = potongan[halaman - 1] ?? [];
  const params = { gudang: gudangId, kategori, q };
  const bolehMinimum = bolehBukaPath(akses.role ?? "", "/pos/stok-minimum", akses.aturan);
  const bolehPembelian = bolehBukaPath(akses.role ?? "", "/pembelian", akses.aturan);
  const unduh = `/laporan/stok-harus-order/unduh?${new URLSearchParams(params)}`;

  return (
    <LaporanPage
      siap={siap}
      unduhTampilan={false}
      icon="ti-shopping-cart" title="STOK HARUS ORDER"
      desc="Barang aktif yang stoknya di bawah minimum atau akan habis sebelum pesanan datang. Dari riwayat penjualan, semua gudang digabung."
      filter={pilihan ? <FilterStok gudang={pilihan.gudang} gudangId={gudangId} kategoriOpsi={pilihan.kategoriOpsi} kategori={kategori} q={q} /> : undefined}
      ringkasan={hasil ? <>
        <KartuAngka items={[
          { label: "Harus order", nilai: `${order.length.toLocaleString("id-ID")} barang`, warna: order.length ? "#b45309" : "#15803d" },
          { label: "Sudah kosong", nilai: `${kosong.toLocaleString("id-ID")} barang`, warna: kosong ? "#b91c1c" : undefined },
          { label: "Perkiraan nilai pesanan", nilai: rupiah(nilaiTotal) },
        ]} />
        <CatatanRiwayat label={labelRiwayat(hasil.ctx)} baru={hasil.ctx.riwayatBaru} />
      </> : undefined}
    >
      {galat ? <div className="p2ban" role="alert" style={{ color: "#b91c1c" }}>{galat}</div> : <>
        {tidakValid.length > 0 && <div className="p2ban">Satuan beli belum punya konversi (saran dihitung per satuan dasar): {tidakValid.slice(0, 20).join(", ")}{tidakValid.length > 20 ? "…" : ""}.</div>}
        <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ fontSize: 10.5, color: "var(--tm)" }}>Buat PO:</span>
          {bolehMinimum && <Link className="btn-def" href="/pos/stok-minimum"><i className="ti ti-file-plus" /> Draft PO dari stok minimum</Link>}
          {bolehPembelian && <Link className="btn-def" href="/pembelian"><i className="ti ti-file-invoice" /> Pesanan Pembelian</Link>}
          <Link className="btn-def" href={unduh}><i className="ti ti-file-spreadsheet" /> Unduh Excel ({order.length} barang)</Link>
        </div>
        {terlihat.length === 0 && <div className="crm-sec" style={{ textAlign: "center", color: "var(--td)", fontSize: 11, padding: "26px 0" }}>Tidak ada barang yang harus dipesan untuk pilihan ini.</div>}
        {terlihat.map((g) => (
          <div className="crm-sec" key={g.supplierId ?? "tanpa"} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>
                <i className="ti ti-building-store" /> {g.supplierNama}
                <span style={{ fontSize: 10.5, fontWeight: 400, color: "var(--tm)" }}> · {g.rows.length} barang</span>
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 700 }}>{rupiah(g.nilai)}</div>
            </div>
            {!g.supplierId && <div style={{ fontSize: 9.5, color: "#b45309", marginBottom: 7 }}><i className="ti ti-alert-triangle" /> Belum ada pemasok utama di master barang.</div>}
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ minWidth: 820, width: "100%" }}>
                <thead><tr>
                  <th>Barang</th><th style={{ textAlign: "right" }}>Stok</th><th style={{ textAlign: "right" }}>Terjual/bulan</th>
                  <th style={{ textAlign: "right" }}>Cukup untuk (hari)</th><th>Alasan</th>
                  <th style={{ textAlign: "right" }}>Saran order</th><th style={{ textAlign: "right" }}>Perkiraan</th>
                </tr></thead>
                <tbody>
                  {g.rows.map((r) => <tr key={r.itemId}>
                    <td style={{ fontSize: 11 }}><span style={{ fontFamily: "var(--mono, monospace)", fontSize: 10, color: "var(--tm)" }}>{r.kode}</span> {r.nama}</td>
                    <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600, color: r.stok <= 0 ? "#b91c1c" : undefined }}>{tampilQty(r.stok)} <span style={{ fontSize: 9, color: "var(--td)" }}>{r.satuan}</span></td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{tampilQty(r.terjualBulan)}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{r.coverHari === null ? "—" : tampilQty(Math.floor(r.coverHari))}</td>
                    <td style={{ fontSize: 11 }}>{r.alasan.map((a) => LABEL_ALASAN[a]).join(", ")}{r.sementara ? " (sementara)" : ""}</td>
                    <td style={{ textAlign: "right", fontSize: 11, fontWeight: 700 }}>{tampilQty(r.qtyPesan)} <span style={{ fontSize: 9, fontWeight: 400, color: "var(--td)" }}>{r.buyUnit}</span></td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{r.nilai > 0 ? rupiah(r.nilai) : "—"}</td>
                  </tr>)}
                  {g.rows.length === 0 && <TabelKosong kolom={7} pesan="Kosong." />}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        <NomorHalaman dasar={HALAMAN_ORDER} params={params} halaman={halaman} total={potongan.length * UKURAN_HALAMAN_STOK} />
        <Definisi>
          Harus order = stok sama dengan atau di bawah minimum, atau stok cukup kurang dari {KONFIG_STOK.leadTimeHari} hari penjualan.
          Barang nonaktif/jasa, dan barang tanpa penjualan sekaligus tanpa minimum, tidak ikut.
          Saran order = isi sampai {KONFIG_STOK.targetCoverHari} hari penjualan (atau minimum bila lebih besar), dibulatkan ke atas ke satuan beli
          dan minimum beli pemasok. Perkiraan memakai harga beli master, atau biaya masuk terakhir bila harga beli kosong.
        </Definisi>
      </>}
    </LaporanPage>
  );
}
