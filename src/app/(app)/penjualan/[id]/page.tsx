import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { DokumenPanel } from "@/components/dokumen/DokumenPanel";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDt = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

type Sale = {
  id: string;
  no_struk: string | null;
  created_at: string;
  subtotal: number;
  discount: number;
  total: number;
  metode_bayar: string;
  bayar: number;
  kembali: number;
  branches: Rel<{ name: string }>;
  customers: Rel<{ name: string; phone: string | null }>;
  kasir: Rel<{ full_name: string | null }>;
  sale_items: { id: string; nama: string; qty: number; harga: number; satuan: string | null }[] | null;
};

type ReturRow = {
  id: string; no_retur: string | null; tanggal: string; total: number;
  sales_return_items: { id: string; nama: string; qty: number }[] | null;
};

export default async function PenjualanDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const { success, error } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from("sales")
    .select("id, no_struk, created_at, subtotal, discount, total, metode_bayar, bayar, kembali, branches(name), customers(name, phone), kasir:cashier_id(full_name), sale_items(id, nama, qty, harga, satuan)")
    .eq("id", id)
    .maybeSingle();

  const sale = data as unknown as Sale | null;
  if (!sale) notFound();

  const { data: returData } = await supabase
    .from("sales_returns")
    .select("id, no_retur, tanggal, total, sales_return_items(id, nama, qty)")
    .eq("sale_id", id)
    .order("tanggal", { ascending: false });
  const returs = (returData ?? []) as unknown as ReturRow[];

  const items = sale.sale_items ?? [];
  const cust = one(sale.customers);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 11, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/penjualan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
          <span style={{ color: "var(--td)" }}>·</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{sale.no_struk ?? "Penjualan"}</span>
        </div>
        <Link href={`/penjualan/retur/baru?struk=${encodeURIComponent(sale.no_struk ?? "")}`} className="btn-def" style={{ textDecoration: "none" }}>
          <i className="ti ti-arrow-back-up" /> Buat retur
        </Link>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Dokumen tersimpan.
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <div className="crm-sec">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingBottom: 12, borderBottom: ".5px solid var(--bd)", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{sale.no_struk ?? "—"}</div>
            <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>{fmtDt(sale.created_at)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9.5, color: "var(--td)", textTransform: "uppercase", letterSpacing: ".03em" }}>Total</div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{rp(Number(sale.total))}</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <Info label="Cabang" value={one(sale.branches)?.name ?? "—"} />
          <Info label="Pelanggan" value={cust?.name ? `${cust.name}${cust.phone ? ` · ${cust.phone}` : ""}` : "Umum"} />
          <Info label="Kasir" value={one(sale.kasir)?.full_name ?? "—"} />
          <Info label="Metode bayar" value={sale.metode_bayar} />
          <Info label="Subtotal" value={rp(Number(sale.subtotal))} />
          <Info label="Diskon" value={rp(Number(sale.discount))} />
          <Info label="Dibayar" value={rp(Number(sale.bayar))} />
          <Info label="Kembalian" value={rp(Number(sale.kembali))} />
        </div>
      </div>

      <div className="crm-sec">
        <SecHeader num="01" title="RINCIAN BARANG" desc="Isi struk penjualan ini." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>No.</th>
                <th>Nama Barang</th>
                <th>Satuan</th>
                <th style={{ textAlign: "center" }}>Qty</th>
                <th style={{ textAlign: "right" }}>Harga</th>
                <th style={{ textAlign: "right" }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 500 }}>{it.nama}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{it.satuan ?? "—"}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{Number(it.qty)}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(it.harga))}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(it.qty) * Number(it.harga))}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>Tidak ada barang.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {returs.length > 0 && (
        <div className="crm-sec">
          <SecHeader num="02" title="RETUR DARI PENJUALAN INI" desc="Barang yang sudah dikembalikan pelanggan." />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {returs.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", border: ".5px solid var(--bd)", borderRadius: 6, fontSize: 11.5 }}>
                <span style={{ fontWeight: 500 }}>{r.no_retur ?? "—"}</span>
                <span style={{ color: "var(--tm)", fontSize: 11 }}>
                  {new Date(r.tanggal + "T00:00:00").toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" })}
                </span>
                <span style={{ color: "var(--tm)", fontSize: 11 }}>{r.sales_return_items?.length ?? 0} item</span>
                <span style={{ marginLeft: "auto", fontWeight: 700 }}>{rp(Number(r.total))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <DokumenPanel modul="penjualan" refId={sale.id} kembali={`/penjualan/${sale.id}`} />
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--td)", letterSpacing: ".03em", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{value}</div>
    </div>
  );
}
