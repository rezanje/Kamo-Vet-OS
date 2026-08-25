import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { ALASAN_WARNA } from "../alasan";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

type Baris = {
  nama: string; qty_sistem: number; qty_baru: number; selisih: number; nilai: number;
  items: Rel<{ code: string; unit: string | null }>;
};
type Doc = {
  id: string; no_adj: string; tanggal: string; alasan: string; keterangan: string | null;
  nilai_masuk: number; nilai_keluar: number;
  warehouses: Rel<{ name: string; code: string }>;
  profiles: Rel<{ full_name: string | null }>;
  inventory_adjustment_items: Baris[] | null;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtD = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric" });

export default async function PenyesuaianDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string }>;
}) {
  const { id } = await params;
  const { success } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from("inventory_adjustments")
    .select("id, no_adj, tanggal, alasan, keterangan, nilai_masuk, nilai_keluar, warehouses(name, code), profiles:created_by(full_name), inventory_adjustment_items(nama, qty_sistem, qty_baru, selisih, nilai, items(code, unit))")
    .eq("id", id).maybeSingle();
  if (!data) notFound();
  const doc = data as unknown as Doc;

  const baris = (doc.inventory_adjustment_items ?? [])
    .slice()
    .sort((a, b) => Math.abs(Number(b.nilai)) - Math.abs(Number(a.nilai)));
  const warna = ALASAN_WARNA[doc.alasan] ?? "#4b5563";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <Link href="/pos/penyesuaian" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{doc.no_adj}</span>
        <span className="bge" style={{
          background: `color-mix(in srgb, ${warna} 12%, transparent)`, color: warna, textTransform: "capitalize",
        }}>{doc.alasan}</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader num="01" title="PENYESUAIAN PERSEDIAAN" desc={doc.keterangan ?? "Tanpa keterangan tambahan."} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <div>
            <div className="flab">Tanggal</div>
            <div style={{ fontSize: 12 }}>{fmtD(doc.tanggal)}</div>
          </div>
          <div>
            <div className="flab">Gudang</div>
            <div style={{ fontSize: 12 }}>{one(doc.warehouses)?.name ?? "—"}</div>
          </div>
          <div>
            <div className="flab">Dibuat oleh</div>
            <div style={{ fontSize: 12 }}>{one(doc.profiles)?.full_name ?? "—"}</div>
          </div>
          <div>
            <div className="flab">Nilai berkurang</div>
            <div style={{ fontSize: 12, color: "#b91c1c" }}>{rp(Number(doc.nilai_keluar))}</div>
          </div>
          <div>
            <div className="flab">Nilai bertambah</div>
            <div style={{ fontSize: 12, color: "#15803d" }}>{rp(Number(doc.nilai_masuk))}</div>
          </div>
        </div>
      </div>

      <div className="crm-sec">
        <SecHeader num="02" title="RINCIAN BARANG" desc={`${baris.length} barang · dinilai modal (HPP), bukan harga jual.`} />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>Kode #</th><th>Nama Barang</th>
                <th style={{ textAlign: "right" }}>Sistem</th>
                <th style={{ textAlign: "right" }}>Jadi</th>
                <th style={{ textAlign: "right" }}>Selisih</th>
                <th>Satuan</th>
                <th style={{ textAlign: "right" }}>Nilai</th>
              </tr>
            </thead>
            <tbody>
              {baris.map((b, i) => {
                const it = one(b.items);
                const minus = Number(b.selisih) < 0;
                return (
                  <tr key={i}>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{it?.code ?? "—"}</td>
                    <td style={{ fontSize: 11.5 }}>{b.nama}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{Number(b.qty_sistem).toLocaleString("id-ID")}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{Number(b.qty_baru).toLocaleString("id-ID")}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: minus ? "#b91c1c" : "#15803d" }}>
                      {Number(b.selisih) > 0 ? "+" : ""}{Number(b.selisih).toLocaleString("id-ID")}
                    </td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{it?.unit ?? ""}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(b.nilai))}</td>
                  </tr>
                );
              })}
              {baris.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Tidak ada rincian.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
