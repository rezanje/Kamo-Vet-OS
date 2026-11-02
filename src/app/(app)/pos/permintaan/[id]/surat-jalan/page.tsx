import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/PrintButton";
import { printBranchHeading } from "@/components/print-branch-heading";
import { bisaCetakSuratJalan, susunSuratJalan, type ItemSuratJalan } from "@/lib/surat-jalan";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

type Detail = {
  id: string;
  no_request: string | null;
  status: string;
  created_at: string;
  shipped_at: string | null;
  catatan: string | null;
  branches: Rel<{ name: string; code: string | null }>;
  warehouses: Rel<{ name: string; code: string | null; branches: Rel<{ name: string; code: string | null }> }>;
  pengirim: Rel<{ full_name: string | null }>;
  stock_request_items: ItemSuratJalan[] | null;
};

const tglJam = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const qty = (v: number) => Number(v.toFixed(6)).toLocaleString("id-ID", { maximumFractionDigits: 6 });

const sel: CSSProperties = { border: ".5px solid #141413", padding: "6px 8px" };
const kepala: CSSProperties = { ...sel, background: "#f1f1ef", fontWeight: 700, textAlign: "left", fontSize: 10.5 };

export default async function SuratJalanPermintaanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("stock_requests")
    .select("id, no_request, status, created_at, shipped_at, catatan, branches(name, code), warehouses!stock_requests_to_warehouse_id_fkey(name, code, branches(name, code)), pengirim:profiles!stock_requests_shipped_by_fkey(full_name), stock_request_items(id, nama, satuan, qty_diminta, qty_disetujui, qty_dikirim)")
    .eq("id", id)
    .maybeSingle();

  const req = data as unknown as Detail | null;
  if (!req) notFound();

  const kembali = `/pos/permintaan/${req.id}`;
  const toko = one(req.branches);
  const gudang = one(req.warehouses);
  const pengirim = one(req.pengirim)?.full_name ?? null;

  // Surat jalan baru sah setelah stok gudang benar-benar keluar (tombol "Kirim barang").
  // Sebelum itu jumlahnya masih bisa berubah, jadi kertasnya bisa beda dengan isi mobil.
  if (!bisaCetakSuratJalan(req.status)) {
    return (
      <>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
          <Link href={kembali} className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
          <span style={{ color: "var(--td)" }}>·</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Surat Jalan {req.no_request ?? ""}</span>
        </div>
        <div role="status" className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e" }}>
          <i className="ti ti-info-circle" /> Surat jalan baru bisa dicetak setelah barang dikirim dari gudang
          (status sekarang: <b>{req.status}</b>). Selesaikan persetujuan dan tekan &quot;Kirim barang&quot; dulu.
        </div>
      </>
    );
  }

  const { baris, tidakDikirim } = susunSuratJalan(req.stock_request_items ?? []);
  const totalQty = baris.reduce((a, b) => a + b.qty, 0);

  return (
    <>
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Link href={kembali} className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Surat Jalan {req.no_request ?? ""}</span>
        <span style={{ marginLeft: "auto" }}><PrintButton label="Cetak surat jalan" /></span>
      </div>

      <div className="rm-doc" style={{ maxWidth: 760, margin: "0 auto", background: "#fff", border: ".5px solid var(--bd)", borderRadius: 10, padding: "26px 30px", fontSize: 11.5, color: "#141413" }}>
        {/* Kop: penerbit surat jalan = cabang pemilik gudang pengirim */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #16213e", paddingBottom: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>KAMO<i className="ti ti-paw" style={{ fontSize: 15, verticalAlign: -1 }} /></div>
            <div style={{ fontSize: 10.5, color: "#555", marginTop: 2 }}>{printBranchHeading(one(gudang?.branches ?? null) ?? gudang)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: ".04em" }}>SURAT JALAN</div>
            <div style={{ fontSize: 11, marginTop: 2 }}>No. {req.no_request ?? "—"}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 24px", marginBottom: 16 }}>
          <KV k="Dari gudang" v={gudang?.name ?? "—"} />
          <KV k="Tanggal kirim" v={req.shipped_at ? tglJam(req.shipped_at) : "—"} />
          <KV k="Kepada (toko)" v={toko?.name ?? "—"} />
          <KV k="Tanggal minta" v={tglJam(req.created_at)} />
          {req.catatan && <KV k="Catatan" v={req.catatan} />}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ ...kepala, width: 32, textAlign: "center" }}>No.</th>
              <th style={kepala}>Nama Barang</th>
              <th style={{ ...kepala, width: 90, textAlign: "right" }}>Jumlah</th>
              <th style={{ ...kepala, width: 80 }}>Satuan</th>
              <th style={{ ...kepala, width: 90, textAlign: "center" }}>Diterima</th>
              <th style={{ ...kepala, width: 120 }}>Keterangan</th>
            </tr>
          </thead>
          <tbody>
            {baris.map((b, i) => (
              <tr key={b.id}>
                <td style={{ ...sel, textAlign: "center" }}>{i + 1}</td>
                <td style={sel}>{b.nama}</td>
                <td style={{ ...sel, textAlign: "right", fontWeight: 700 }}>{qty(b.qty)}</td>
                <td style={sel}>{b.satuan ?? "—"}</td>
                <td style={sel}>&nbsp;</td>
                <td style={sel}>&nbsp;</td>
              </tr>
            ))}
            {baris.length === 0 && (
              <tr><td colSpan={6} style={{ ...sel, textAlign: "center", color: "#555" }}>Tidak ada barang yang dikirim.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ ...sel, textAlign: "right", fontWeight: 700 }}>Total ({baris.length} jenis barang)</td>
              <td style={{ ...sel, textAlign: "right", fontWeight: 800 }}>{qty(totalQty)}</td>
              <td colSpan={3} style={sel}>&nbsp;</td>
            </tr>
          </tfoot>
        </table>

        {tidakDikirim.length > 0 && (
          <div style={{ fontSize: 10, color: "#555", marginTop: 8 }}>
            Diminta tapi tidak ikut dikirim: {tidakDikirim.join(", ")}.
          </div>
        )}
        <div style={{ fontSize: 10, color: "#555", marginTop: 8 }}>
          Penerima mohon cek jumlah &amp; kondisi barang, isi kolom &quot;Diterima&quot;, lalu catat penerimaan di sistem.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 30, marginTop: 34, fontSize: 10.5, textAlign: "center", breakInside: "avoid" }}>
          <TandaTangan judul="Disiapkan (Gudang)" nama={pengirim} />
          <TandaTangan judul="Pengirim / Sopir" nama={null} />
          <TandaTangan judul="Diterima (Toko)" nama={null} />
        </div>
      </div>
    </>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <span style={{ color: "#555", minWidth: 100 }}>{k}</span>
      <span style={{ fontWeight: 600 }}>: {v}</span>
    </div>
  );
}

function TandaTangan({ judul, nama }: { judul: string; nama: string | null }) {
  return (
    <div>
      <div style={{ color: "#555" }}>{judul}</div>
      <div style={{ borderTop: ".5px solid #141413", marginTop: 52, paddingTop: 3 }}>( {nama ?? "____________________"} )</div>
    </div>
  );
}
