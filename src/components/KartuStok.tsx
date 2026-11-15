// Dua kartu dashboard: "Slow moving / stok berlebih" dan "Harus order". Hanya tampilan; angkanya dari
// lib/stok-analisis (dihitung semua gudang digabung dari riwayat penjualan).
import Link from "next/link";
import { denganTampil } from "@/lib/report-gate";
import { HALAMAN_ORDER, HALAMAN_SLOW, LABEL_STATUS, rupiahRingkas, tampilBulan, tampilQty } from "@/lib/stok-analisis";
import type { KartuStok } from "@/lib/stok-analisis-server";

/** Peringatan riwayat pendek: tampil di kartu dan di kedua halaman. */
export function CatatanRiwayat({ label, baru }: { label: string; baru: boolean }) {
  return (
    <div data-catatan-riwayat style={{ fontSize: 10.5, color: baru ? "#b45309" : "var(--tm)", marginTop: 6 }}>
      {baru ? <><i className="ti ti-alert-triangle" /> Dihitung dari {label}: angka masih sementara, belum pasti.</> : <>Dihitung dari {label}.</>}
    </div>
  );
}

function Baris({ kiri, kanan, sub }: { kiri: string; kanan: string; sub?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "3px 0", fontSize: 11, borderBottom: ".5px solid var(--bd)" }}>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {kiri}{sub && <span style={{ color: "var(--tm)", fontSize: 10 }}> · {sub}</span>}
      </span>
      <span style={{ fontWeight: 600, flexShrink: 0 }}>{kanan}</span>
    </div>
  );
}

export function KartuStokDashboard({ data }: { data: KartuStok }) {
  if (!data) return null;
  if (data.galat !== undefined) {
    return (
      <div className="card" role="alert" data-kartu-stok-galat style={{ marginBottom: 13 }}>
        <div className="card-hd"><i className="ti ti-alert-triangle" style={{ color: "#d97706" }} /> Stok: slow moving &amp; harus order</div>
        <p style={{ fontSize: 11.5, margin: 0, color: "var(--tm)" }}>{data.galat}</p>
      </div>
    );
  }
  const { slow, order, portofolio } = data;
  return (
    <div data-kartu-stok style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11, marginBottom: 13 }}>
      {slow && (
        <div className="card" data-kartu-slow style={{ minWidth: 0 }}>
          <div className="card-hd"><i className="ti ti-snowflake" style={{ color: "#0369a1" }} /> Slow moving / stok berlebih</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{slow.jumlah.toLocaleString("id-ID")} barang</div>
          <div style={{ fontSize: 12, marginTop: 2 }}>Modal tertahan <b>{rupiahRingkas(slow.modalTertahan)}</b></div>
          <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 2 }}>
            Semua stok cukup untuk {tampilBulan(portofolio.coverBulan)} bulan penjualan{portofolio.berlebih ? " (berlebih)" : ""}.
          </div>
          <div style={{ margin: "8px 0 4px" }}>
            {slow.top.length === 0 ? <div style={{ fontSize: 11, color: "var(--td)" }}>Tidak ada.</div> :
              slow.top.map((b) => <Baris key={b.id} kiri={b.nama} sub={LABEL_STATUS[b.status]} kanan={rupiahRingkas(b.modalTertahan)} />)}
          </div>
          <CatatanRiwayat label={data.label} baru={data.riwayatBaru} />
          <div style={{ marginTop: 6, fontSize: 11 }}><Link href={denganTampil(HALAMAN_SLOW)} style={{ color: "#2563eb" }}>Lihat semua</Link></div>
        </div>
      )}
      {order && (
        <div className="card" data-kartu-order style={{ minWidth: 0 }}>
          <div className="card-hd"><i className="ti ti-shopping-cart" style={{ color: "#b45309" }} /> Harus order</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: order.jumlah ? "#b45309" : "#15803d" }}>{order.jumlah.toLocaleString("id-ID")} barang</div>
          <div style={{ fontSize: 12, marginTop: 2 }}>Perkiraan nilai pesanan <b>{rupiahRingkas(order.nilai)}</b></div>
          <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 2 }}>Di bawah minimum, atau stok cukup kurang dari 14 hari.</div>
          <div style={{ margin: "8px 0 4px" }}>
            {order.top.length === 0 ? <div style={{ fontSize: 11, color: "var(--td)" }}>Tidak ada.</div> :
              order.top.map((o) => (
                <Baris key={o.itemId} kiri={o.nama}
                  sub={o.coverHari === null ? "di bawah minimum" : `cukup ${Math.floor(o.coverHari)} hari`}
                  kanan={`${tampilQty(o.qtyPesan)} ${o.buyUnit ?? o.satuan}`} />
              ))}
          </div>
          <CatatanRiwayat label={data.label} baru={data.riwayatBaru} />
          <div style={{ marginTop: 6, fontSize: 11 }}><Link href={denganTampil(HALAMAN_ORDER)} style={{ color: "#2563eb" }}>Lihat semua</Link></div>
        </div>
      )}
    </div>
  );
}
